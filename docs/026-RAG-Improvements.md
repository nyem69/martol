# RAG Improvements — Lessons from Production

**Date:** 2026-03-19
**Status:** Proposed
**Priority:** 2
**Depends on:** 024-Server-Side-RAG-Responder (complete), 025-RAG-Quality-Improvements (complete)

## Summary

Production testing of the RAG responder revealed several issues that need addressing. This doc captures the problems encountered, root causes, and planned improvements.

## Problems Encountered

### P1: AI SDK `streamText()` produces zero tokens with Workers AI

**Symptom:** Docs AI returned empty bubbles — `streamText()` from the `ai` package yielded zero tokens from `result.textStream`.

**Root cause:** Unknown. The `workers-ai-provider` (v3.1.2) and `ai` (v6.0.116) are installed but the streaming pipeline silently produces nothing. Direct `env.AI.run()` works reliably.

**Current fix:** Replaced `streamText()` with direct `env.AI.run()`. Response is sent as chunked `stream_delta` events for progressive rendering.

**Impact:** Lost AI SDK benefits (unified provider interface, tool calling, structured output). The `ai` and `workers-ai-provider` packages are still installed but unused for LLM generation.

**Future investigation:**
- [ ] Test `streamText()` with a minimal repro outside the DO
- [ ] Check if the issue is DO-specific (dynamic import + async generator in `ctx.waitUntil`)
- [ ] Report to `workers-ai-provider` GitHub if confirmed as a bug
- [ ] Re-enable AI SDK once the issue is resolved

### P2: English-only reranker demotes Malay documents

**Symptom:** Query "apa fatwa pasal zakat fitrah?" returned 198.pdf (mosque/judge topics) and 077.pdf (asnaf definitions) instead of 028.pdf and 014.pdf (actual zakat fitrah content).

**Root cause:** `@cf/baai/bge-reranker-base` is English-only. It re-scored Malay document chunks using English semantics, promoting irrelevant chunks that happened to have higher English-language similarity scores.

**Current fix:** Reranker disabled. Using pure BGE-M3 vector search (which IS multilingual).

**Future fix:**
- [ ] Monitor Cloudflare for a multilingual reranker model (`bge-reranker-v2-m3` or similar)
- [ ] When available, re-enable reranking with the multilingual model
- [ ] Alternative: implement language-aware reranking — skip reranker for non-English queries

### P3: Prompt too large — 26K chars caused empty responses

**Symptom:** Workers AI returned empty response for a 26,526-char prompt.

**Root cause:** topK=10 chunks × ~500 words each = ~5,000 words (~20K chars) + system prompt with few-shot example = 26K chars total. Workers AI silently returns empty when the prompt is too large for the neuron budget.

**Current fix:**
- Word cap reduced from 8,000 to 3,000 (~12K chars max)
- Hard 12K char truncation before `env.AI.run()` as safety net
- topK=10 retrieved but only ~5-6 chunks fit within the word cap

### P4: Multi-topic chunks dilute embeddings

**Symptom:** "ada ke fatwa pasal black metal?" returned "not found" even though 198.pdf chunk 1 contains extensive Black Metal fatwa content.

**Root cause:** 198.pdf contains 8+ separate fatwa rulings in one document. The chunker splits by word count (500 words), not by topic. Chunk 1 contains Black Metal content mixed with judge appointment and masjid construction content. The mixed embedding doesn't match a specific "black metal" query well enough to rank in top-10.

**Current workaround:** Increased topK to 10 for wider recall. But the fundamental issue is chunking strategy.

**Proper fix:** Topic-aware chunking — see Improvement 1 below.

### P5: LLM responds in Bahasa Indonesia instead of Bahasa Melayu

**Symptom:** Responses used Indonesian words ("menemukan", "informasi") instead of Malay ("menjumpai", "maklumat").

**Root cause:** Llama 3.1 8B doesn't distinguish well between Malay and Indonesian. Without explicit guidance, it defaults to the more common Indonesian.

**Current fix:** System prompt now includes:
- Few-shot example in Bahasa Melayu
- Explicit "Bahasa Melayu NOT Bahasa Indonesia" instruction
- Word-level guidance: "menjumpai" not "menemukan"

### P6: LLM only cited one source despite multiple relevant documents

**Symptom:** Query about zakat fitrah returned content from 028.pdf only, ignoring equally relevant 191.pdf.

**Root cause:** System prompt said "be concise" which the LLM interpreted as "pick one source."

**Current fix:** Updated prompt to "cite EVERY relevant source" with chronological ordering (newest first) and a multi-source few-shot example.

## Planned Improvements

### Improvement 1: Topic-Aware Chunking

**Problem:** Fixed 500-word windows ignore document structure. Multi-topic documents (like 198.pdf with 8 fatwa rulings) produce chunks with mixed content that don't embed well for specific queries.

**Solution options:**

| Approach | Complexity | Quality | Workers-compatible |
|---|---|---|---|
| **A. Heading-based splitting** | Low | Medium | Yes |
| **B. Regex topic detection** | Medium | Good | Yes |
| **C. LLM-based splitting** | High | Best | Expensive (neurons) |
| **D. Semantic chunking** | High | Good | Needs embedding per split |

**Recommended: Approach A + B combined**

1. **Heading detection** — scan for patterns like `[Hukum ...]`, `[Kedudukan ...]`, `FATWA BERKENAAN` that indicate topic boundaries in fatwa documents
2. **Split at headings** — create chunks at topic boundaries instead of fixed word counts
3. **Fallback** — if no headings found, use current 500-word fixed chunking
4. **Per-topic metadata** — extract the heading text as `documentTitle` for the chunk

**Implementation:**

```typescript
// chunker.ts — add topic-aware splitting

const TOPIC_HEADING_RE = /\[([^\]]{5,200})\]/g;  // [Hukum Membina Masjid]
const FATWA_HEADING_RE = /FATWA\s+(?:BERKENAAN|DI\s+BAWAH)/i;

function splitByTopics(text: string, maxWords: number = 800): TextChunk[] {
    const headings = [...text.matchAll(TOPIC_HEADING_RE)];
    if (headings.length < 2) return []; // Fallback to word-based

    const chunks: TextChunk[] = [];
    for (let i = 0; i < headings.length; i++) {
        const start = headings[i].index!;
        const end = headings[i + 1]?.index ?? text.length;
        const content = text.slice(start, end).trim();
        if (content.length > 50) {
            chunks.push({
                index: chunks.length,
                content: content.slice(0, maxWords * 5), // ~maxWords words
                tokenEstimate: content.split(/\s+/).length,
                charStart: start,
                charEnd: Math.min(start + maxWords * 5, end),
            });
        }
    }
    return chunks;
}
```

**Files:**
- `src/lib/server/rag/chunker.ts` — add `splitByTopics()`, try it first, fallback to `chunkText()`
- `src/lib/server/rag/process-document.ts` — wire topic-aware splitting

### Improvement 2: Streaming via Workers AI Streaming API

**Problem:** Currently using non-streaming `env.AI.run()` and faking progressive rendering by chunking the complete response. Users see the full response appear in bursts, not token-by-token.

**Solution:** Workers AI supports streaming via `stream: true` option:

```typescript
const stream = await env.AI.run(model, {
    messages: [...],
    stream: true,
});
// stream is a ReadableStream of SSE events
```

Each SSE event contains a partial response token. Parse and broadcast as real `stream_delta` events.

**Implementation:**
- `src/lib/server/chat-room.ts` — replace `env.AI.run()` with streaming variant
- Parse SSE `data:` lines from the ReadableStream
- Broadcast each token as a `stream_delta`
- Accumulate full body for WAL commit

### Improvement 3: Complete Metadata Read Path

**Problem:** Phase 2 of 025 extracted metadata (date, title, language) during ingestion and stored in DB, but the search function never reads it and the prompt never displays it.

**Solution:** Wire the metadata through the full path:

1. `search.ts` — add `documentDate`, `documentTitle`, `language` to the SELECT query and `SearchResult` interface
2. `responder.ts` — update `buildUserPrompt()` to include metadata in chunk headers:
   ```
   [📄 198.pdf | Fatwa 2007 | Chunk 1]
   ```
3. Format chunk headers conditionally — show title/date only when available

**Files:**
- `src/lib/server/rag/search.ts` — extend SELECT and SearchResult
- `src/lib/server/rag/responder.ts` — extend `buildUserPrompt()` signature and formatting

### Improvement 4: Re-enable AI SDK When Fixed

**Problem:** AI SDK `streamText()` doesn't work with Workers AI in a Durable Object context.

**Investigation steps:**
1. Create a minimal test Worker (not DO) that calls `streamText()` with `workers-ai-provider`
2. If it works in a Worker but not a DO, the issue is DO-specific (dynamic import, async context)
3. If it fails in both, file an issue on `cloudflare/workers-ai-provider`
4. Test with the AI SDK's `rerank()` function for reranking (separate from `streamText`)

**Value:** Re-enabling AI SDK would give us:
- Unified provider interface (swap models by changing one string)
- Structured output via `generateObject()` with Zod
- Tool calling for agent-style RAG
- Cleaner streaming via `textStream`

### Improvement 5: Reduce Chunk Overlap Waste

**Problem:** Current chunker uses 50-word overlap between chunks. For 500-word chunks, that's 10% overlap — reasonable for long documents but wasteful for short ones.

**Solution:** Make overlap proportional to chunk size:
- Short docs (<1000 words): no overlap (single chunk)
- Medium docs (1000-5000 words): 25-word overlap
- Long docs (>5000 words): 50-word overlap (current)

### Improvement 6: Workers AI Model Selection

**Problem:** Default model is `@cf/meta/llama-3.1-8b-instruct`. For Malay content, this model has limited capability and frequently produces Indonesian instead of Malay.

**Options:**

| Model | Languages | Quality | Cost |
|---|---|---|---|
| `@cf/meta/llama-3.1-8b-instruct` | Weak Malay | OK | Cheapest |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Better Malay | Good | 10x more neurons |
| `@cf/qwen/qwen3-32b` | Good multilingual | Very good | 4x more neurons |
| External (GPT-4o-mini via OpenAI) | Excellent Malay | Best | BYOK cost |

**Recommendation:** Test `qwen3-32b` — Qwen models have strong multilingual support (the rag-fatwa project uses Qwen successfully for Malay). If neuron cost is acceptable, make it the default for rooms with Malay documents.

## Build Sequence

### Phase 1 — Topic-aware chunking (highest impact)

- [ ] Add `splitByTopics()` to `chunker.ts` with heading regex detection
- [ ] Wire into `processDocument()` — try topic split first, fallback to word-based
- [ ] Re-process 198.pdf and other multi-topic documents
- [ ] Verify: "black metal" query finds the correct chunk

### Phase 2 — Real streaming

- [ ] Switch `env.AI.run()` to streaming mode (`stream: true`)
- [ ] Parse SSE events from ReadableStream
- [ ] Broadcast real token-by-token `stream_delta` events
- [ ] Remove fake chunked response broadcasting

### Phase 3 — Metadata read path

- [ ] Extend `SearchResult` with `documentDate`, `documentTitle`, `language`
- [ ] Update DB query in `searchDocuments()` to SELECT metadata columns
- [ ] Update `buildUserPrompt()` to render metadata in chunk headers
- [ ] Re-process documents to ensure metadata is populated

### Phase 4 — Model testing

- [ ] Test `@cf/qwen/qwen3-32b` for Malay content quality
- [ ] Compare neuron cost vs Llama 3.1 8B
- [ ] If quality justifies cost, make it configurable per room
- [ ] Document model recommendations for different languages

### Phase 5 — AI SDK investigation

- [ ] Minimal test Worker for `streamText()` + `workers-ai-provider`
- [ ] Determine if issue is DO-specific
- [ ] File bug report if confirmed
- [ ] Re-enable when fixed

## Files

### Modify

| File | Change |
|---|---|
| `src/lib/server/rag/chunker.ts` | Add `splitByTopics()` with heading detection |
| `src/lib/server/rag/process-document.ts` | Wire topic-aware chunking |
| `src/lib/server/chat-room.ts` | Real streaming via Workers AI stream API |
| `src/lib/server/rag/search.ts` | Extend SearchResult with metadata fields |
| `src/lib/server/rag/responder.ts` | Metadata-rich chunk headers in prompt |

## Lessons Learned

### Workers AI on Cloudflare has hidden limits

- Prompt size matters more than documented. A 26K char prompt silently returns empty.
- The 10K neuron/day limit applies to free tier only; paid plans have higher limits but neurons still cost money.
- AI SDK `streamText()` doesn't work reliably in Durable Objects — direct `env.AI.run()` is more reliable.

### Embedding quality ≠ retrieval quality

- BGE-M3 embeddings are multilingual and excellent, but multi-topic chunks dilute embeddings regardless of model quality.
- Chunking strategy matters more than embedding model for retrieval precision.
- Fixed word-count chunking works for homogeneous documents but fails for multi-topic compilations.

### Reranking can hurt non-English content

- English-only reranker (`bge-reranker-base`) actively degrades Malay retrieval.
- Always match reranker language capability to the content language.
- No reranking is better than wrong-language reranking.

### Malay vs Indonesian is a real problem

- LLMs (especially smaller ones) don't distinguish Malay from Indonesian well.
- Explicit word-level guidance in the system prompt helps but doesn't fully solve it.
- Few-shot examples in the target language (Malay) are essential.
- Qwen models reportedly handle Malay better than Llama — needs testing.

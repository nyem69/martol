# RAG Improvements — Lessons from Production

**Date:** 2026-03-19
**Revised:** 2026-03-19 (post-review)
**Status:** Proposed
**Priority:** 2
**Depends on:** 024-Server-Side-RAG-Responder (complete), 025-RAG-Quality-Improvements (complete)

## Summary

Production testing of the RAG responder revealed several issues that need addressing. This doc captures the problems encountered, root causes, planned improvements, and review feedback.

## Problems Encountered

### P1: AI SDK `streamText()` produces zero tokens with Workers AI

**Symptom:** Docs AI returned empty bubbles — `streamText()` from the `ai` package yielded zero tokens from `result.textStream`.

**Root cause:** Unknown — likely DO-specific (dynamic import + async generator in `ctx.waitUntil`). The AI SDK is used by thousands of Cloudflare developers in regular Workers, suggesting the issue is environment-specific.

**Current fix:** Replaced `streamText()` with direct `env.AI.run()`. Dead code (`createRagModel`, AI SDK imports) removed from `responder.ts`.

**Packages `ai`, `workers-ai-provider`, `@ai-sdk/openai` remain in `package.json`** — tree-shaking excludes them from the bundle since no top-level imports exist. Consider removing entirely if investigation (Phase 2) confirms the bug is unfixable.

### P2: English-only reranker demotes Malay documents

**Symptom:** Query "apa fatwa pasal zakat fitrah?" returned 198.pdf (mosque/judge topics) and 077.pdf (asnaf definitions) instead of 028.pdf and 014.pdf (actual zakat fitrah content).

**Root cause:** `@cf/baai/bge-reranker-base` is English-only. It re-scored Malay document chunks using English semantics, promoting irrelevant chunks.

**Current fix:** Reranker disabled globally. Using pure BGE-M3 vector search.

**Review feedback:** Disabling globally is too aggressive. Language detection already exists (`metadata-extractor.ts`). Enable reranking for English queries, skip for Malay/mixed. This is a 10-line change — see Phase 1.

### P3: Prompt too large — 26K chars caused empty responses

**Symptom:** Workers AI returned empty response for a 26,526-char prompt.

**Root cause:** topK=10 × ~500 words + system prompt = 26K chars. Workers AI silently returns empty — the actual failure threshold is unknown.

**Current fix:** Word cap 3,000, hard 12K char truncation, topK=10 with word cap limiting to ~5-6 chunks.

**Review feedback:** The 3,000-word cap is arbitrary. Actual Workers AI limit needs investigation — see Phase 3. The hard 12K truncation is a reasonable safety net regardless.

### P4: Multi-topic chunks dilute embeddings

**Symptom:** "ada ke fatwa pasal black metal?" returned "not found" despite 198.pdf containing Black Metal fatwa content.

**Root cause:** 198.pdf has 8+ fatwa rulings in one document. Fixed 500-word chunking mixes topics.

**Current workaround:** topK=10 for wider recall.

**Status:** Need to verify if topK=10 now finds the Black Metal content. If yes, topic-aware chunking is a quality improvement, not a critical fix.

### P5: LLM responds in Bahasa Indonesia instead of Bahasa Melayu

**Current fix:** System prompt with explicit BM guidance + few-shot example in Malay.

**Review feedback:** Verify if this prompt fix adequately resolves the issue before investing in model upgrades (Qwen3).

### P6: LLM only cited one source

**Current fix:** "Cite EVERY relevant source" with multi-source few-shot example.

## Evaluation Framework (Required Before Any Improvement)

**Review finding:** All improvements lack measurable criteria. Adding a test corpus is a prerequisite.

### Test Corpus

Create `scripts/rag-eval.ts` with 10-15 known query/expected-source pairs:

| Query | Expected source(s) | Expected content |
|---|---|---|
| Apa fatwa pasal zakat fitrah? | 028.pdf, 191.pdf, 109.pdf | Kadar zakat fitrah, RM amounts |
| Ada ke fatwa pasal black metal? | 198.pdf (chunk 1) | Kumpulan Black Metal sesat |
| Senaraikan fatwa yang ada | Multiple files | List of fatwa topics |
| Fatwa berkenaan autopsi maya | 198.pdf (chunk 2) | Virtual autopsy |
| Hukum pelaburan ASN/ASB | Varies | Investment ruling |

**Run protocol:**
1. Call `searchDocuments()` with each query
2. Check if expected filename appears in top-N results
3. Report recall@5 and recall@10
4. Run before and after each improvement to measure impact

## Planned Improvements

### Improvement 1: Topic-Aware Chunking + Language-Conditional Reranking

**Problem:** Fixed 500-word windows ignore document structure. Multi-topic documents produce chunks with mixed content that don't embed well.

**Solution: Multi-pattern heading detection (not single regex)**

Review identified that the original `\[([^\]]{5,200})\]` regex is too narrow (fatwa-specific). Use multiple patterns:

```typescript
const HEADING_PATTERNS = [
    /(?:^|\n)\[([A-Z][^\]]{5,200})\]/g,           // [Hukum Membina Masjid]
    /(?:^|\n)#{1,3}\s+(.{5,200})$/gm,              // Markdown headings
    /(?:^|\n)(?:BAHAGIAN|CHAPTER|SECTION)\s+.+$/gim, // All-caps sections
    /(?:^|\n)\d+\.\s+[A-Z].{5,200}$/gm,            // Numbered sections
    /FATWA\s+(?:BERKENAAN|DI\s+BAWAH)/gi,           // Fatwa-specific
];
```

**Additional rules from review:**
- **Minimum chunk size:** 100 words. Merge smaller chunks with adjacent.
- **Maximum chunk size:** 500 words (not 800 — keeps 6 chunks within 3000-word cap).
- **Long topic sections:** Sub-split with existing `chunkText()` + 50-word overlap.
- **No overlap between topic chunks** — accepted tradeoff; topics are semantically distinct.

**Language-conditional reranking:** Re-enable `bge-reranker-base` for English queries only:
```typescript
const queryLang = detectLanguage(query); // existing function
if (queryLang === 'en' && merged.length > topK) {
    merged = await rerankResults(ai, query, merged, topK);
} else if (merged.length > topK) {
    merged = merged.slice(0, topK);
}
```

**Re-processing logic** (missing from original plan):
```typescript
async function reprocessDocument(db, vectorize, attachmentId) {
    // 1. Get existing vectorIds
    const chunks = await db.select({ vectorId }).from(documentChunks)
        .where(eq(documentChunks.attachmentId, attachmentId));
    // 2. Delete from Vectorize
    if (chunks.length > 0) {
        await vectorize.deleteByIds(chunks.map(c => c.vectorId));
    }
    // 3. Delete from DB
    await db.delete(documentChunks).where(eq(documentChunks.attachmentId, attachmentId));
    // 4. Reset status
    await db.update(attachments).set({ processingStatus: 'pending' })
        .where(eq(attachments.id, attachmentId));
}
```

**Files:**
- `src/lib/server/rag/chunker.ts` — add `splitByTopics()` with multi-pattern detection
- `src/lib/server/rag/process-document.ts` — wire topic-aware splitting + `reprocessDocument()`
- `src/lib/server/rag/search.ts` — language-conditional reranking

### Improvement 2: AI SDK Investigation (moved up from Phase 5)

**Review feedback:** Investigation should not be deferred. A minimal repro takes 30 minutes.

**Steps:**
1. Create `scripts/test-ai-sdk-worker.ts` — plain Worker (not DO) calling `streamText()`
2. If it works → the bug is DO-specific. Try calling from a regular route handler instead of DO.
3. If it fails → file issue on `cloudflare/workers-ai-provider`
4. Consider removing `ai`, `workers-ai-provider`, `@ai-sdk/openai` from `package.json` if unfixable

### Improvement 3: Investigate Workers AI Prompt Limits

**Review feedback:** The 3000-word cap is arbitrary. Find the real limit.

**Steps:**
1. Test with incrementally larger prompts: 10K, 15K, 20K, 25K, 30K chars
2. Document the actual failure threshold for `@cf/meta/llama-3.1-8b-instruct`
3. Check if it's char-based, token-based, or neuron-budget-based
4. Adjust the cap based on findings (may be able to increase to 5000 words)

### Improvement 4: Complete Metadata Read Path

**Problem:** Metadata (date, title, language) extracted during ingestion but never read.

**Solution:** Wire through search → prompt:

```typescript
// SearchResult extension
interface SearchResult {
    // ...existing fields...
    documentDate?: string | null;
    documentTitle?: string | null;
    language?: string | null;
}

// Conditional header formatting (handle null gracefully)
const header = [
    `📄 ${c.filename}`,
    c.documentTitle,
    c.documentDate,
    `Chunk ${c.chunkIndex}`,
].filter(Boolean).join(' | ');
```

### Improvement 5: Real Streaming (deprioritized)

**Review feedback:** Current fake-chunked approach is adequate for short RAG responses (~200-500 chars). Real token-by-token streaming adds SSE parsing complexity for minimal UX gain. Deprioritize unless responses grow significantly longer.

**If implemented:** Need a proper SSE parser that handles:
- Chunk boundary framing (SSE events split across `read()` calls)
- `data: [DONE]` sentinel (not valid JSON)
- Backpressure (batch tokens every 50-100ms before broadcasting)

### Improvement 6: Model Selection

**Review feedback:** Verify Qwen3-32b availability on Workers AI before committing. Add runtime model fallback. Do cost analysis first.

**Prerequisite:** Verify P5 prompt fix effectiveness. If BM/BI confusion is resolved by prompt alone, model upgrade is only for reasoning quality (may not justify 4x neuron cost).

**Cost analysis needed:**

| Model | Est. neurons/query | Monthly cost (100 queries/day) | Quality |
|---|---|---|---|
| Llama 3.1 8B | ~5,000 | ~$1.65 | OK (with prompt fixes) |
| Qwen3-32b (if available) | ~20,000 | ~$6.60 | Likely better |
| Llama 3.3 70B FP8 | ~50,000 | ~$16.50 | Best on Workers AI |
| GPT-4o-mini (BYOK) | N/A | ~$3/mo (user pays) | Best overall |

### Improvement 7: Reduce topK/Word-Cap Waste

**Review feedback:** topK=10 retrieves 10 chunks from DB, but the 3000-word cap only uses ~5-6. The extra 4-5 chunks are wasted DB queries.

**Fix:** Either reduce topK to 7 (small headroom for reranking), or pass word budget into `searchDocuments()` for early termination.

## Build Sequence

### Phase 1 — Evaluation + chunking + reranking fix ✅ (code shipped)

- [x] Create `scripts/rag-eval.ts` with test corpus (10 queries)
- [ ] Run baseline evaluation (needs deploy + API key)
- [x] Add multi-pattern `splitByTopics()` to `chunker.ts` (5 patterns)
- [x] Add `reprocessDocument()` cleanup function
- [x] Wire into `processDocument()` — try topic split first, fallback to word-based
- [x] Add language-conditional reranking (English=rerank, Malay=vector-only)
- [ ] Re-process multi-topic documents (198.pdf, etc.)
- [ ] Run evaluation again — compare recall@5, recall@10

### Phase 2 — AI SDK investigation ✅

- [x] Investigate workers-ai-provider source code
- [x] Root cause identified: ReadableStream from `env.AI.run({stream:true})` closes when DO request context finalizes in `ctx.waitUntil()`. SSE pipeline dies.
- [x] Bundle impact: zero (all imports commented out, tree-shaken by esbuild)
- [ ] File issue on `cloudflare/workerd` or `cloudflare/workers-sdk` (runtime issue, not provider bug)
- Packages kept — zero cost, easier to re-enable if Workers runtime fixes the stream lifecycle

### Phase 3 — Metadata read path + topK ✅

- [x] Wire metadata read path: search.ts SELECT → SearchResult → buildUserPrompt headers
- [x] Conditional chunk headers: `[📄 file | title | date | Chunk N]` (null-safe)
- [x] Reduce topK: 10 → 7 (matches 3000-word cap, less DB waste)
- [ ] Test actual Workers AI prompt size limits (deferred — current 3000-word cap works)

### Phase 4 — Model testing (only if P5 prompt fix insufficient)

- [ ] Verify Qwen3-32b availability on Workers AI
- [ ] Test Malay content quality vs Llama 8B
- [ ] Cost analysis: neuron cost at projected usage
- [ ] Make model configurable per room (already supported via room_config)

### Phase 5 — Real streaming (deprioritized)

- [ ] Only if responses grow longer (multi-paragraph)
- [ ] SSE parser with chunk boundary handling
- [ ] Token batching (50-100ms) before broadcasting

## Files

### Create

| File | Purpose |
|---|---|
| `scripts/rag-eval.ts` | Evaluation script with test corpus |

### Modify

| File | Change |
|---|---|
| `src/lib/server/rag/chunker.ts` | Multi-pattern `splitByTopics()`, min/max chunk guards |
| `src/lib/server/rag/process-document.ts` | Topic-aware chunking + `reprocessDocument()` |
| `src/lib/server/rag/search.ts` | Language-conditional reranking, metadata in SearchResult |
| `src/lib/server/rag/responder.ts` | Metadata-rich chunk headers |
| `src/lib/server/chat-room.ts` | Reduce topK waste |

## Review Issues Addressed

| ID | Issue | Source | Resolution |
|---|---|---|---|
| F1 | No metrics/evaluation | Devil | Added test corpus requirement as Phase 1 prerequisite |
| F2 | Dead AI SDK code in responder.ts | Devil | Removed (committed) |
| F3 | 3000-word cap arbitrary | Devil, Cloudflare | Added prompt limit investigation as Phase 3 |
| F4 | CLAUDE.md embedding model drift | Cloudflare | Fixed (committed) |
| F5 | No re-processing logic | Chunking | Added `reprocessDocument()` design |
| C1 | Heading regex too narrow | Chunking | Multi-pattern detection |
| C2 | No minimum chunk size | Chunking | 100-word minimum, merge small chunks |
| C3 | topK waste (10 fetched, 5 used) | Cloudflare, Chunking | Improvement 7 |
| C4 | Reranker disabled globally | Devil | Language-conditional reranking |
| C5 | AI SDK investigation at Phase 5 | Devil | Moved to Phase 2 |
| C6 | Qwen3-32b unconfirmed | Cloudflare | Verify before committing |
| C7 | 800-word topic chunks vs 3000-word cap | Cloudflare | Keep max at 500 words |
| C8 | Plan has no timeline | Devil | Added phased build sequence with eval gates |

## Lessons Learned

### Workers AI on Cloudflare has hidden limits

- Prompt size matters more than documented. A 26K char prompt silently returns empty.
- The actual failure threshold is unknown — needs investigation (Phase 3).
- AI SDK `streamText()` doesn't work in Durable Objects — likely a DO-specific issue, not a general SDK bug.

### Embedding quality ≠ retrieval quality

- BGE-M3 embeddings are multilingual and excellent, but multi-topic chunks dilute embeddings regardless of model quality.
- Chunking strategy matters more than embedding model for retrieval precision.
- Fixed word-count chunking works for homogeneous documents but fails for multi-topic compilations.

### Reranking is language-dependent

- English-only reranker (`bge-reranker-base`) actively degrades Malay retrieval.
- The correct approach is **language-conditional reranking**, not global disable.
- Language detection infrastructure already exists (`detectLanguage()` in metadata-extractor).

### Malay vs Indonesian is a real problem

- LLMs (especially smaller ones) don't distinguish Malay from Indonesian well.
- Explicit word-level guidance in the system prompt helps significantly.
- Few-shot examples in the target language are essential.
- Model upgrade (Qwen3) may help but should be evaluated after prompt fixes are validated.

### Measure before optimizing

- Every RAG improvement should be validated against a test corpus with known answers.
- Without baseline metrics, you cannot tell if an improvement helped or hurt.
- A simple recall@K evaluation (10 queries, 5 minutes to run) is the minimum viable framework.

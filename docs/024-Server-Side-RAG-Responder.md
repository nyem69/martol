# Server-Side RAG Responder

**Date:** 2026-03-17
**Status:** Proposed
**Priority:** 2
**Depends on:** 018-Document-Intelligence (complete), 019-Streaming (complete)

## Summary

Allow users to upload documents and ask questions answered by an LLM — without running `martol-client`. The server calls the LLM directly, using the existing RAG pipeline for context. Zero external processes, zero agent setup.

**Use case:** "I uploaded 5 PDFs. Answer my questions based on them."

## The Problem

Today, getting LLM-powered answers from uploaded documents requires:

1. Upload documents via chat UI (works)
2. Run `martol-client` pointing at an LLM provider
3. Configure API keys, model, base URL
4. Keep the process running

For a user who just wants document Q&A, this is too much friction. The RAG pipeline (extract → chunk → embed → search) is already server-side. The missing piece is the last mile: calling an LLM with the search results and streaming the answer back.

## Architecture

**Vercel AI SDK (`ai` + `workers-ai-provider`) as the unified LLM abstraction, streamed through the existing DO WebSocket path.**

```
User sends message (no agent connected)
  → SvelteKit hook detects "no agent, RAG enabled"
  → doc_search: embed query → Vectorize → get chunks
  → Build prompt: system + chunks + user question
  → AI SDK streamText() — Workers AI or OpenAI-compatible
  → Stream response via DO: stream_start → N × stream_delta → stream_end
  → Browser renders progressively (existing streaming UI)
```

### Why Vercel AI SDK

- **Unified API** — `streamText()` works identically for Workers AI, OpenAI, Anthropic, Ollama, Groq, etc.
- **No manual SSE parsing** — the SDK handles streaming for all providers
- **Structured output** — `generateObject()` with Zod for citation extraction
- **Tool calling** — `doc_search` can be an AI SDK tool (cleaner than manual orchestration)
- **Edge-compatible** — `workers-ai-provider` is built for Cloudflare Workers
- **Future-proof** — swap models by changing one string, not rewriting provider code

### Why Workers AI as default

- Already bound (`env.AI`) — zero additional config
- Free tier: 10K neurons/day on most models
- No API key management for basic use
- Llama 3.1 8B and Mistral 7B available
- Fallback: any AI SDK provider for better models

### Why not a separate service

- The RAG pipeline (embeddings, Vectorize, chunk DB) already runs server-side
- Adding the LLM call in the same Worker avoids network hops
- Streaming uses the existing DO WebSocket infrastructure
- One deployment, one codebase

## Dependencies

```bash
pnpm add ai workers-ai-provider
# For external OpenAI-compatible providers:
pnpm add @ai-sdk/openai
```

| Package | Purpose | Size |
|---|---|---|
| `ai` | AI SDK core — `streamText`, `generateText`, `generateObject` | ~50 KB |
| `workers-ai-provider` | Workers AI provider — `createWorkersAI` | ~5 KB |
| `@ai-sdk/openai` | OpenAI/compatible provider — GPT-4o, Ollama, Groq, etc. | ~15 KB |

**Worker size impact:** ~70 KB gzipped added to the current ~9.3 MB bundle (well within 10 MB limit).

## LLM Provider Configuration

### Per-room settings (organization metadata)

**Workers AI (zero-config default):**

```json
{
  "rag_responder": {
    "enabled": true,
    "provider": "workers_ai",
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "temperature": 0.3,
    "max_tokens": 2048
  }
}
```

**OpenAI / any compatible endpoint:**

```json
{
  "rag_responder": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4o-mini",
    "base_url": "https://api.openai.com/v1",
    "api_key_ref": "env:RAG_API_KEY",
    "temperature": 0.3,
    "max_tokens": 4096
  }
}
```

**Ollama (local):**

```json
{
  "rag_responder": {
    "enabled": true,
    "provider": "openai",
    "model": "llama3.2",
    "base_url": "http://localhost:11434/v1",
    "temperature": 0.3,
    "max_tokens": 2048
  }
}
```

### Provider hierarchy

1. **Room-level config** (org metadata `rag_responder`) — highest priority
2. **Instance-level default** (env vars `RAG_PROVIDER`, `RAG_MODEL`) — fallback
3. **Workers AI** with Llama 3.1 8B — zero-config default

### Supported providers (via AI SDK)

| Provider | AI SDK Package | Config `provider` value | Notes |
|---|---|---|---|
| Workers AI | `workers-ai-provider` | `workers_ai` | Default. Free tier. Llama, Mistral, Gemma |
| OpenAI | `@ai-sdk/openai` | `openai` | GPT-4o, GPT-4o-mini |
| Ollama | `@ai-sdk/openai` | `openai` | Local. Set `base_url` |
| Groq | `@ai-sdk/openai` | `openai` | Fast inference. Set `base_url` |
| Together AI | `@ai-sdk/openai` | `openai` | Open models. Set `base_url` |
| Any OpenAI-compatible | `@ai-sdk/openai` | `openai` | vLLM, LM Studio, etc. |

All providers use the same `streamText()` call — only the model instance differs.

## Trigger Logic

### When does the server respond?

The server-side RAG responder activates when ALL of:

1. **Room has RAG responder enabled** (`rag_responder.enabled === true`)
2. **Room has indexed documents** (at least 1 document with chunks in Vectorize)
3. **No agent is connected** to the room (checked via DO presence roster)
4. **Message is a question or mentions @docs** (heuristic + explicit trigger)

### Question detection heuristic

Simple and cheap — no LLM call for detection:

- Message ends with `?`
- Message starts with common question words: "what", "how", "why", "when", "where", "who", "which", "can", "does", "is", "are", "do", "will", "should", "explain", "describe", "summarize", "find"
- Message mentions `@docs` or `@rag` (explicit trigger, always activates)
- Message is a `/ask` slash command

### Override: always-on mode

If `rag_responder.trigger === "always"`, respond to every message (not just questions). Useful for dedicated document Q&A rooms.

## Data Flow

```
1. User sends message via WebSocket
   → DO handleChatMessage() persists + broadcasts as normal

2. DO checks: should RAG respond?
   → Is rag_responder enabled for this org?
   → Are there indexed documents?
   → Is any agent connected? (check activeConnections for role=agent)
   → Does message match trigger heuristic?

3. If yes: DO sends internal request to /api/rag/respond
   POST { orgId, messageBody, messageId, ragConfig }
   (via ctx.waitUntil — non-blocking)

4. /api/rag/respond handler:
   a. doc_search: embed query → Vectorize → top 5 chunks
   b. Build prompt with chunks as context
   c. AI SDK streamText() — unified for all providers
   d. Stream response back to DO:
      - POST /stream-start { localId, senderName: "Docs AI" }
      - POST /stream-delta { localId, delta } (per chunk from AI SDK)
      - POST /stream-end { localId, body }

5. DO broadcasts stream events to all connected browsers
   → Existing streaming UI renders progressively
```

## AI SDK Integration

### Model creation (per-request, from room config)

```typescript
import { streamText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';

function createModel(config: RagConfig, env: Env) {
  switch (config.provider) {
    case 'workers_ai': {
      const workersai = createWorkersAI({ binding: env.AI });
      return workersai(config.model);
    }
    case 'openai': {
      const openai = createOpenAI({
        baseURL: config.base_url,
        apiKey: config.api_key_ref?.startsWith('env:')
          ? env[config.api_key_ref.slice(4)]
          : config.api_key_ref,
      });
      return openai(config.model);
    }
    default: {
      // Fallback to Workers AI
      const workersai = createWorkersAI({ binding: env.AI });
      return workersai('@cf/meta/llama-3.1-8b-instruct');
    }
  }
}
```

### Streaming response generation

```typescript
async function generateRagResponse(
  query: string,
  chunks: DocChunk[],
  roomName: string,
  config: RagConfig,
  env: Env
): Promise<AsyncIterable<string>> {
  const model = createModel(config, env);

  const result = streamText({
    model,
    system: buildSystemPrompt(roomName),
    prompt: buildUserPrompt(query, chunks),
    temperature: config.temperature ?? 0.3,
    maxTokens: config.max_tokens ?? 2048,
  });

  return result.textStream;
}
```

### Alternative: doc_search as an AI SDK tool

Instead of pre-fetching chunks, let the LLM decide when to search:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const docSearchTool = tool({
  description: 'Search uploaded documents for relevant information',
  parameters: z.object({
    query: z.string().describe('Search query'),
    top_k: z.number().min(1).max(10).default(5),
  }),
  execute: async ({ query, top_k }) => {
    const results = await searchDocuments(orgId, query, top_k, env);
    return results.map(r => ({
      content: r.content,
      source: r.filename,
      citation: r.citation,
    }));
  },
});

const result = streamText({
  model,
  system: 'You are a document assistant. Use the doc_search tool to find relevant information before answering.',
  prompt: userQuestion,
  tools: { doc_search: docSearchTool },
  maxSteps: 3, // Allow up to 3 tool calls
});
```

**Trade-off:** Tool-based approach is more flexible (LLM decides what to search) but costs an extra round-trip. Pre-fetch approach is faster and cheaper for simple Q&A. Start with pre-fetch; add tool-based as an opt-in later.

### Structured citations with generateObject

For extracting structured citations from a response:

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const citationSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({
    filename: z.string(),
    chunk_index: z.number(),
    relevance: z.enum(['high', 'medium', 'low']),
  })),
  confidence: z.enum(['high', 'medium', 'low']),
});

// Use for non-streaming structured responses
const result = await generateObject({
  model,
  schema: citationSchema,
  prompt: buildPrompt(query, chunks),
});
```

## Prompt Template

```
You are a document assistant for the "{room_name}" workspace.
Answer questions based ONLY on the provided document excerpts.
If the answer is not in the documents, say so clearly.
Always cite sources using [📄 filename] format.

## Document Excerpts

{chunks with citations}

## User Question

{message_body}
```

### Chunk formatting

```
[Source: report-q4.pdf, chunk 3]
Revenue increased 15% year-over-year, driven primarily by...

[Source: architecture.md, chunk 1]
The system uses a microservices architecture with...
```

## Component Design

### `src/lib/server/rag/responder.ts` (new)

Main orchestrator:

- `shouldRespond(orgId, message, ragConfig, hasAgents)` — trigger logic
- `generateResponse(orgId, query, ragConfig, env)` — uses AI SDK `streamText()`, returns `textStream`
- `createModel(config, env)` — creates AI SDK model from room config
- `buildSystemPrompt(roomName)` — system prompt with grounding rules
- `buildUserPrompt(query, chunks)` — user question with chunk context

**No manual SSE parsing.** The AI SDK handles all provider-specific streaming protocols internally.

### `src/routes/api/rag/respond/+server.ts` (new)

Internal-only POST endpoint (called by DO via `ctx.waitUntil`):

- Validates `X-Internal-Secret`
- Runs doc_search (existing `searchDocuments()`)
- Creates model from config via `createModel()`
- Calls `streamText()` — iterates `textStream`
- Streams response back to DO via `/stream-start`, `/stream-delta`, `/stream-end`

### `src/lib/server/chat-room.ts` (modified)

- After `handleChatMessage`: check trigger, fire `ctx.waitUntil(fetch('/api/rag/respond', ...))` if conditions met
- New `/rag-respond` internal route (alternative to external endpoint — keeps it in the DO)

### `src/routes/api/rooms/[roomId]/rag-config/+server.ts` (new)

PATCH endpoint for room owners to configure RAG responder:

- Enable/disable
- Set provider, model, temperature, max_tokens
- Set trigger mode (questions / always / off)
- Validate API key connectivity (optional ping)

### Chat UI additions

- **RAG config panel** in room settings (simple form: enable toggle, provider dropdown, model input)
- **"Docs AI" sender identity** — messages from the server-side responder show as a system agent with a distinct badge
- **"Based on N documents" footer** — show citation count below RAG responses

## Identity

The RAG responder uses a synthetic sender identity:

| Field | Value |
|---|---|
| `senderId` | `rag-responder-{orgId}` |
| `senderName` | "Docs AI" (or room-configured name) |
| `senderRole` | `agent` |

This is NOT a real user/agent in the members table. The DO REST ingest endpoint already accepts arbitrary sender info — no schema change needed.

## Spending Cap Integration

RAG responder calls count against the existing AI usage caps:

| Operation | Counter | Cap (Free) | Cap (Pro) |
|---|---|---|---|
| doc_search (per question) | `vector_query` | 50/day | 500/day |
| LLM generation (per question) | `llm_generation` (new) | 20/day | 200/day |

Add `llm_generation` operation type to `aiUsage` table tracking.

## Build Sequence

### Phase 1 — AI SDK integration + responder core

- [ ] `pnpm add ai workers-ai-provider @ai-sdk/openai`
- [ ] Create `src/lib/server/rag/responder.ts`:
  - `createModel(config, env)` — Workers AI via `createWorkersAI`, OpenAI via `createOpenAI`
  - `shouldRespond()` — trigger heuristic
  - `buildSystemPrompt()`, `buildUserPrompt()`
  - `generateResponse()` — calls `streamText()`, returns `textStream`
- [ ] Add `llm_generation` operation type to AI usage tracking
- [ ] Verify: `streamText()` works with Workers AI binding in local `wrangler dev`

### Phase 2 — DO integration + streaming

- [ ] Add trigger check in `handleChatMessage` (post-broadcast)
- [ ] Create `/api/rag/respond` internal endpoint
- [ ] Iterate `textStream` → POST `/stream-start`, `/stream-delta`, `/stream-end` to DO
- [ ] Synthetic sender identity for "Docs AI"
- [ ] Delta coalescing: buffer 50ms before sending delta to DO (same as agent streaming)

### Phase 3 — Configuration

- [ ] Create `src/routes/api/rooms/[roomId]/rag-config/+server.ts` (PATCH + GET)
- [ ] Parse `rag_responder` from org metadata in DO and respond endpoint
- [ ] Add env vars: `RAG_PROVIDER`, `RAG_MODEL`, `RAG_API_KEY`, `RAG_BASE_URL`
- [ ] Validate model connectivity on config save (optional health check)

### Phase 4 — UI

- [ ] Add RAG config section to room settings panel
- [ ] "Docs AI" badge in MessageBubble for RAG responses
- [ ] Citation footer on RAG response messages
- [ ] `/ask` slash command
- [ ] Add i18n keys

### Phase 5 — Tool-based search (optional enhancement)

- [ ] Define `doc_search` as AI SDK `tool()` with Zod schema
- [ ] Add `maxSteps: 3` to `streamText()` for multi-turn tool use
- [ ] UI: show tool call grouping (020) for RAG tool calls
- [ ] Config flag: `rag_responder.use_tools: true` (opt-in)

### Phase 6 — Hardening

- [ ] Spending cap enforcement for `llm_generation`
- [ ] Rate limiting (max 5 RAG responses/minute/room)
- [ ] Timeout: 30s max generation time (AI SDK `abortSignal`)
- [ ] Error handling: LLM failure → visible error message in chat
- [ ] Verify: no response when agent IS connected (agent takes priority)
- [ ] Verify: works with Workers AI free tier limits
- [ ] Monitor Worker bundle size (should stay under 10 MB)

## Files

### Create

| File | Purpose |
|---|---|
| `src/lib/server/rag/responder.ts` | RAG responder — model creation, trigger logic, prompt building, `streamText()` |
| `src/routes/api/rag/respond/+server.ts` | Internal endpoint — doc_search + LLM + stream to DO |
| `src/routes/api/rooms/[roomId]/rag-config/+server.ts` | RAG config PATCH/GET endpoint |

### Modify

| File | Change |
|---|---|
| `package.json` | Add `ai`, `workers-ai-provider`, `@ai-sdk/openai` |
| `src/lib/server/chat-room.ts` | Trigger check after message broadcast, `/rag-respond` route |
| `src/lib/server/db/schema.ts` | Add `llm_generation` to AI usage operations |
| `src/lib/components/chat/MessageBubble.svelte` | "Docs AI" badge, citation footer |
| `src/lib/components/chat/ChatInput.svelte` | `/ask` slash command |
| `messages/en.json` | RAG-related i18n keys |
| `wrangler.toml` | Default env vars for RAG provider |

## Design Decisions

**Why Vercel AI SDK instead of raw `env.AI.run()` + `fetch()`?** The AI SDK eliminates ~200 lines of manual SSE parsing, provider switching, and streaming plumbing. `streamText()` is 5 lines and works identically for Workers AI, OpenAI, Ollama, and 40+ other providers. The package cost is ~70 KB — trivial.

**Why `workers-ai-provider` instead of `@ai-sdk/openai` for Workers AI?** The community provider uses the native `env.AI` binding (no HTTP overhead), supports all Workers AI model types (chat, embeddings, image, transcription, TTS, reranking), and handles Workers AI-specific streaming format internally.

**Why `@ai-sdk/openai` for external providers?** It's the official AI SDK provider for OpenAI-compatible APIs. Setting `baseURL` makes it work with Ollama, Groq, Together, vLLM, LM Studio — any endpoint that speaks the OpenAI chat completions protocol.

**Why pre-fetch chunks instead of tool-based search?** Pre-fetch is simpler, faster (1 LLM call vs 2+), and cheaper. Tool-based search is more flexible but costs extra tokens and latency. We start with pre-fetch and add tool-based as Phase 5 opt-in.

**Why trigger heuristic instead of always responding?** Avoids noise. Users send greetings, status updates, file uploads — not everything needs an LLM response. The `@docs` mention and `/ask` command provide explicit control.

**Why synthetic sender instead of a real agent?** No API key, no member row, no billing. The responder is a room feature, not a user. Using the existing REST ingest with arbitrary sender info keeps it simple.

**Why not call the LLM inside the DO?** DOs have a 30-second CPU limit and no external fetch timeout control. Running the LLM call in a regular Worker request (via `ctx.waitUntil` or internal endpoint) is safer and can be independently rate-limited.

**Why store config in org metadata (TEXT) instead of a new table?** The RAG config is a small JSON blob (~200 bytes) that changes rarely. A dedicated table is overkill — org metadata already exists and is read at page load. If config grows complex, migrate to a typed table later.

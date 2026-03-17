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

**Server-side LLM call via Workers AI or user-provided OpenAI-compatible endpoint, streamed through the existing DO WebSocket path.**

```
User sends message (no agent connected)
  → SvelteKit hook detects "no agent, RAG enabled"
  → doc_search: embed query → Vectorize → get chunks
  → Build prompt: system + chunks + user question
  → Call LLM (Workers AI or external API)
  → Stream response via DO: stream_start → N × stream_delta → stream_end
  → Browser renders progressively (existing streaming UI)
```

### Why Workers AI as default

- Already bound (`env.AI`) — zero additional config
- Free tier: 10K neurons/day on most models
- No API key management for basic use
- Llama 3.1 8B and Mistral 7B available
- Fallback: user-provided OpenAI-compatible endpoint for better models

### Why not a separate service

- The RAG pipeline (embeddings, Vectorize, chunk DB) already runs server-side
- Adding the LLM call in the same Worker avoids network hops
- Streaming uses the existing DO WebSocket infrastructure
- One deployment, one codebase

## LLM Provider Configuration

### Per-room settings (organization metadata)

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

Or for an external provider:

```json
{
  "rag_responder": {
    "enabled": true,
    "provider": "openai_compat",
    "model": "gpt-4o-mini",
    "base_url": "https://api.openai.com/v1",
    "api_key_ref": "env:OPENAI_API_KEY",
    "temperature": 0.3,
    "max_tokens": 4096
  }
}
```

### Provider hierarchy

1. **Room-level config** (org metadata `rag_responder`) — highest priority
2. **Instance-level default** (env vars `RAG_PROVIDER`, `RAG_MODEL`) — fallback
3. **Workers AI** with Llama 3.1 8B — zero-config default

### Supported providers

| Provider | Config key | Notes |
|---|---|---|
| Workers AI | `workers_ai` | Default. Free tier. Models: Llama 3.1 8B, Mistral 7B, Gemma 7B |
| OpenAI | `openai_compat` | GPT-4o, GPT-4o-mini. Requires API key |
| Ollama | `openai_compat` | Local. `base_url: http://host:11434/v1` |
| Any OpenAI-compatible | `openai_compat` | vLLM, Together, Groq, etc. |

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
   c. Call LLM (Workers AI or external)
   d. Stream response back to DO:
      - POST /stream-start { localId, senderName: "Docs AI" }
      - POST /stream-delta { localId, delta } (per chunk)
      - POST /stream-end { localId, body }

5. DO broadcasts stream events to all connected browsers
   → Existing streaming UI renders progressively
```

## Prompt Template

```
You are a document assistant for the "{room_name}" workspace.
Answer questions based ONLY on the provided document excerpts.
If the answer is not in the documents, say so clearly.
Always cite sources using the provided citation format.

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
- `generateResponse(orgId, query, ragConfig, env)` — async generator yielding string deltas
- `buildPrompt(query, chunks, roomName)` — assemble system + context + question
- `callWorkersAI(prompt, config, env)` — Workers AI text generation
- `callOpenAICompat(prompt, config)` — fetch-based OpenAI streaming

### `src/lib/server/rag/responder-providers.ts` (new)

LLM provider abstraction (server-side):

- `WorkersAIProvider` — uses `env.AI.run()` with streaming
- `OpenAICompatProvider` — uses `fetch()` to OpenAI-compatible endpoints with SSE parsing

### `src/routes/api/rag/respond/+server.ts` (new)

Internal-only POST endpoint (called by DO via `ctx.waitUntil`):

- Validates `X-Internal-Secret`
- Runs doc_search
- Calls LLM
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

## Workers AI Streaming

Workers AI supports streaming via the `stream: true` option:

```typescript
const stream = await env.AI.run(model, {
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userQuestion }
  ],
  stream: true,
  temperature: 0.3,
  max_tokens: 2048
});

// stream is a ReadableStream of SSE events
for await (const chunk of stream) {
  // parse SSE, extract delta text
  yield delta;
}
```

## OpenAI-Compatible Streaming

Standard SSE via fetch:

```typescript
const res = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model,
    messages,
    stream: true,
    temperature,
    max_tokens
  })
});

// Parse SSE stream
const reader = res.body.getReader();
// ... parse "data: {...}" lines, extract delta.content
```

## Spending Cap Integration

RAG responder calls count against the existing AI usage caps:

| Operation | Counter | Cap (Free) | Cap (Pro) |
|---|---|---|---|
| doc_search (per question) | `vector_query` | 50/day | 500/day |
| LLM generation (per question) | `llm_generation` (new) | 20/day | 200/day |

Add `llm_generation` operation type to `aiUsage` table tracking.

## Build Sequence

### Phase 1 — Server-side LLM providers

- [ ] Create `src/lib/server/rag/responder-providers.ts` with `WorkersAIProvider` and `OpenAICompatProvider`
- [ ] Unit test: Workers AI streaming mock
- [ ] Unit test: OpenAI-compatible SSE parsing

### Phase 2 — RAG responder core

- [ ] Create `src/lib/server/rag/responder.ts` with `shouldRespond`, `generateResponse`, `buildPrompt`
- [ ] Add `llm_generation` operation type to AI usage tracking
- [ ] Wire doc_search + LLM into a single flow

### Phase 3 — DO integration

- [ ] Add trigger check in `handleChatMessage` (post-broadcast)
- [ ] Add internal `/rag-respond` route to DO (or external endpoint)
- [ ] Stream LLM response via existing stream_start/delta/end protocol
- [ ] Synthetic sender identity for "Docs AI"

### Phase 4 — Configuration

- [ ] Create `src/routes/api/rooms/[roomId]/rag-config/+server.ts` (PATCH)
- [ ] Parse `rag_responder` from org metadata in relevant handlers
- [ ] Add env vars: `RAG_PROVIDER`, `RAG_MODEL`, `RAG_API_KEY`, `RAG_BASE_URL`

### Phase 5 — UI

- [ ] Add RAG config section to room settings panel
- [ ] "Docs AI" badge in MessageBubble for RAG responses
- [ ] Citation footer on RAG response messages
- [ ] `/ask` slash command
- [ ] Add i18n keys

### Phase 6 — Hardening

- [ ] Spending cap enforcement for `llm_generation`
- [ ] Rate limiting (max 5 RAG responses/minute/room)
- [ ] Timeout: 30s max generation time
- [ ] Error handling: LLM failure → visible error message in chat
- [ ] Verify: no response when agent IS connected (agent takes priority)
- [ ] Verify: works with Workers AI free tier limits

## Files

### Create

| File | Purpose |
|---|---|
| `src/lib/server/rag/responder.ts` | RAG responder orchestrator |
| `src/lib/server/rag/responder-providers.ts` | Workers AI + OpenAI-compat LLM providers |
| `src/routes/api/rooms/[roomId]/rag-config/+server.ts` | RAG config PATCH endpoint |

### Modify

| File | Change |
|---|---|
| `src/lib/server/chat-room.ts` | Trigger check after message broadcast, /rag-respond route |
| `src/lib/server/db/schema.ts` | Add `llm_generation` to AI usage operations |
| `src/lib/components/chat/MessageBubble.svelte` | "Docs AI" badge, citation footer |
| `src/lib/components/chat/ChatInput.svelte` | `/ask` slash command |
| `messages/en.json` | RAG-related i18n keys |
| `wrangler.toml` | Default env vars for RAG provider |

## Design Decisions

**Why not reuse martol-client's provider abstraction?** It's Python. The server is TypeScript on Cloudflare Workers. A thin fetch-based provider (~50 lines) is simpler than bridging languages.

**Why trigger heuristic instead of always responding?** Avoids noise. Users send greetings, status updates, file uploads — not everything needs an LLM response. The `@docs` mention and `/ask` command provide explicit control.

**Why synthetic sender instead of a real agent?** No API key, no member row, no billing. The responder is a room feature, not a user. Using the existing REST ingest with arbitrary sender info keeps it simple.

**Why not call the LLM inside the DO?** DOs have a 30-second CPU limit and no external fetch timeout control. Running the LLM call in a regular Worker request (via `ctx.waitUntil` or internal endpoint) is safer and can be independently rate-limited.

**Why not use Cloudflare AI Gateway?** It's an option for future observability/caching, but adds deployment complexity. Direct `env.AI.run()` is simpler for v1.

**Why store config in org metadata (TEXT) instead of a new table?** The RAG config is a small JSON blob (~200 bytes) that changes rarely. A dedicated table is overkill — org metadata already exists and is read at page load. If config grows complex, migrate to a typed table later.

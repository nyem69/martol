# Document Intelligence

**Date:** 2026-03-10 (updated 2026-03-14)
**Status:** Implemented (Phase 1–6 complete, hardened)
**Depends on:** 006-Image-Upload (implemented), existing RAG pipeline (implemented)

## Table of Contents

- [Summary](#summary)
- [Current State](#current-state)
- [Architecture](#architecture)
- [Document UI](#document-ui)
- [Operational Reference](#operational-reference)
- [Dependencies](#dependencies)
- [Billing Impact](#billing-impact)
- [Risks & Known Issues](#risks--known-issues)
- [Development History](#development-history)
  - [Implementation Phases](#implementation-phases)
  - [Changelog](#changelog)
  - [Lessons Learned](#lessons-learned)

## Summary

Upgrade Martol from basic file storage to a full document intelligence system. Users and agents upload documents (PDF, DOCX, XLSX, PPTX, text, HTML, JSON, YAML, XML), Martol extracts text via unpdf (PDFs), Kreuzberg WASM (Office formats), or direct decoding (text types), chunks and embeds it, then serves semantic search with citations. A new document panel lets users browse, search, and manage room documents directly. Images (OCR) are accepted for upload/storage but not yet parsed — see [OCR Status](#ocr-status).

## Current State

The RAG pipeline is fully operational. PDF extraction, semantic search, agent doc_search, and document UI all work end-to-end.

| Component | Status | Notes |
|-----------|--------|-------|
| Upload API (R2 + auth + quotas) | Done | `POST /api/upload` with magic byte validation |
| Attachments table (full metadata) | Done | `parserName`, `contentSha256`, `extractedAt`, etc. |
| Async ingestion pipeline | Done | `processDocument()` via `ctx.waitUntil()` |
| Pluggable parser interface | Done | `ExtractionProvider` with `registerProvider()` |
| Text/Markdown extraction | Done | `builtin-text` provider |
| PDF extraction | **Done** | unpdf (serverless PDF.js) — `d204692` |
| Chunker (word-boundary, offsets) | Done | 500-word windows, 50-word overlap, char offsets |
| Embedder (BGE-base-en-v1.5) | Done | 768-dim, Workers AI, batch embed + Vectorize upsert |
| Document chunks table | Done | `vectorId`, `charStart`/`charEnd`, `embeddingModel` |
| Ingestion jobs table | Done | Job tracking with retry support |
| AI usage metering | Done | Daily counters per org, cap enforcement |
| Semantic search | Done | Vectorize query with org filter + DB chunk join |
| MCP `doc_search` tool | **Done** | Agent-facing search — working with SDK MCP tool |
| Cron retry for failed jobs | **Done** | Fixed: attachment-level retry with dedup — `9911d40` |
| File delete (R2 + vectors + DB) | Done | Owner/lead only, full cascade |
| User-facing document UI | **Done** | Document panel with search — `00ced5c` |
| DOCX/XLSX/PPTX extraction | **Done** | Kreuzberg WASM (manual wasm-bindgen init in worker-entry.ts) |
| Email/archive/ODT support | **Upload-only** | Accepted for storage; extraction requires new providers |
| Vectorize metadata index | **Done** | Required for org-scoped filtering — created manually |

**Remaining gaps:** Images require an OCR-capable provider (Phase 6 UI exists but backend is non-functional). Email (.eml) and archive (ZIP) extraction not yet implemented. See [OCR Status](#ocr-status).

## Architecture

### Extraction Layer — unpdf + Kreuzberg WASM

> **Historical note:** The original plan was to use `@kreuzberg/wasm` for all document types. The official `initWasm()` failed on Workers, but manual wasm-bindgen initialization works — see [Lessons Learned](#lessons-learned). PDF extraction uses `unpdf` (serverless PDF.js); Office formats use Kreuzberg WASM.

```
Upload arrives (any supported type)
  |
  v
R2 store + attachments row (processingStatus: 'pending')
  |
  v  ctx.waitUntil()
processDocument()
  |
  v
kreuzbergProvider.extract(buffer, contentType, filename)
  |                    |                    |
  |  text/plain,       |  PDF               |  DOCX, XLSX, PPTX
  |  text/markdown,    |  -> unpdf           |  -> Kreuzberg WASM
  |  text/csv, HTML,   |  (serverless        |  (manual wasm-bindgen
  |  JSON, YAML, XML   |   PDF.js)           |   init in worker-entry.ts)
  |  -> TextDecoder     |                    |
  |                    |                    |
  v                    v                    v
ExtractionResult { text, parserName, parserVersion, contentSha256, pageCount }
  |
  v
chunkText() -> embedAndIndex() -> documentChunks + Vectorize
```

The provider file is still named `kreuzberg-provider.ts` for historical reasons but uses `unpdf` for PDF extraction and direct `TextDecoder` for plain text types.

### Supported Formats

**Extraction-supported** (uploaded AND parsed for RAG):

| Category | Formats | MIME Types |
|----------|---------|------------|
| Documents | PDF | `application/pdf` (via unpdf) |
| Text | Plain, Markdown, CSV | `text/plain`, `text/markdown`, `text/csv` |
| Web | HTML, XML | `text/html`, `application/xml`, `text/xml` |
| Data | JSON, YAML | `application/json`, `text/yaml`, `application/x-yaml` |
| Office | DOCX, XLSX, PPTX | `application/vnd.openxmlformats-officedocument.*` (via Kreuzberg WASM) |

**Upload-only** (stored in R2 but NOT parsed — no extraction provider):

| Category | Formats | MIME Types |
|----------|---------|------------|
| Office | ODT | `application/vnd.oasis.opendocument.*` |
| Email | EML | `message/rfc822` |
| Archives | ZIP, gzip | `application/zip`, `application/gzip` |
| Images | JPEG, PNG, GIF, WebP, TIFF | `image/*` (OCR disabled — see [OCR Status](#ocr-status)) |

## Document UI

### Document Panel (sidebar)

A slide-out panel (like MemberPanel) showing all room documents:

```
+----------------------------------+
| Documents (12)           [Search]|
|----------------------------------|
| [PDF] quarterly-report.pdf       |
|   Indexed - 2,340 words - 3 min  |
|                                   |
| [DOC] meeting-notes.docx         |
|   Processing...                   |
|                                   |
| [IMG] architecture-scan.png      |
|   OCR indexed - 890 words - 1h   |
|                                   |
| [TXT] README.md                  |
|   Indexed - 1,200 words - 2d     |
+----------------------------------+
```

Features:
- File type icon + filename + status badge (pending/processing/indexed/failed/skipped)
- Word count and relative timestamp
- Click to download
- Delete button (owner/lead only)
- Failed items show error + retry button

### User Search

A search bar in the document panel (or a `/search` command in chat):

```
+----------------------------------+
| Search: "deployment strategy"    |
|----------------------------------|
| quarterly-report.pdf (92% match) |
| "...the deployment strategy      |
|  involves blue-green rollouts..." |
|  — page 14, chars 4201-4450      |
|                                   |
| meeting-notes.docx (78% match)   |
| "...agreed on a phased deployment |
|  strategy starting Q2..."         |
|  — section 3                      |
+----------------------------------+
```

Features:
- Real-time semantic search using existing `searchDocuments()` infrastructure
- Snippet preview with match highlighting
- Source attribution (filename, page/section, character range)
- Click to download source document

### Citation Rendering in Agent Responses

When agents use `doc_search` and include results, the response can contain citation markers that render as interactive references:

Agent message:
> The deployment uses blue-green rollouts [quarterly-report.pdf, p.14]. The team agreed on phased deployment [meeting-notes.docx, §3].

Citations rendered as clickable links that:
- Highlight the source in the document panel
- Show the full chunk in a tooltip/popover
- Link to the document download

**Implementation:** The MCP `doc_search` tool already returns `filename`, `chunkIndex`, `charStart`, `charEnd`, and `score`. Agents can format citations naturally. The client-side markdown renderer can detect `[filename.ext, ...]` patterns following search results and render them as interactive citation links.

## Operational Reference

### Deployment Checklist

Before first deploy or after infrastructure changes:

1. **Vectorize index** — create metadata index before any documents are uploaded:
   ```bash
   npx wrangler vectorize create-metadata-index martol-docs --property-name orgId --type string
   ```
   Vectors upserted before index creation are NOT included — they must be re-upserted.

2. **Worker size** — verify gzipped size stays under 10 MB:
   ```bash
   npx wrangler deploy --dry-run 2>&1 | grep -i size
   ```
   Current: ~9.3 MB (Kreuzberg WASM is ~7.5 MB of that).

3. **Required bindings** — all must be present in `wrangler.toml`:
   - `AI` — Workers AI (embeddings + future OCR)
   - `VECTORIZE` — martol-docs index
   - `STORAGE` — R2 bucket
   - `HYPERDRIVE` — PostgreSQL connection
   - `CHAT_ROOM` — Durable Object (for document-indexed notifications)
   - `HMAC_SIGNING_SECRET` — internal DO auth

4. **Cron trigger** — must be configured for RAG retry/cleanup:
   ```toml
   [triggers]
   crons = ["*/5 * * * *"]
   ```

### Cron Jobs

The cron (`worker-entry.ts`) runs every 5 minutes and handles:

1. **Stuck job cleanup** — marks `running` jobs older than 5 minutes as `failed` with `processing_timeout`
2. **Pending dispatch** — finds `pending` attachments with no active (`running`/`pending`) ingestion job and dispatches them
3. **Failed retry** — finds `failed` attachments with < 3 total attempts (across all jobs) and no active job, then re-dispatches with backoff (1min after 1st failure, 5min after 2nd)

### Error Codes

Stored in `attachments.extractionErrorCode`. Common codes:

| Code | Meaning | Action |
|------|---------|--------|
| `extraction_timeout` | Exceeded 120s timeout | Retry; if persistent, file may be too complex |
| `extraction_empty` | Parser returned no text | File may be empty or image-only PDF |
| `extraction_failed` | Generic extraction error | Check logs for stack trace |
| `kreuzberg_not_available` | Kreuzberg WASM not initialized | Check worker-entry.ts init logs |
| `wasm_init_failed` | WASM instantiation failed | Deploy issue — check Worker startup |
| `embedding_failed` | Workers AI embedding call failed | AI binding issue or rate limit |
| `vectorize_upsert_failed` | Vectorize insert failed | Check index exists and quota |
| `r2_object_missing` | File not found in R2 | Orphaned DB record — file deleted from R2 |
| `ai_cap_reached` | Org hit monthly AI spending cap | Expected; user needs to wait or upgrade |
| `processing_timeout` | Job ran >5 min (cron cleanup) | Cron marked it; may warrant manual retry |
| `attachment_not_found` | DB record missing for attachment ID | Data inconsistency |

### Monitoring

Key log prefixes to watch in Workers logs:

| Prefix | What it means |
|--------|---------------|
| `[RAG]` | Document processing pipeline (extract, chunk, embed, index) |
| `[RAG:waitUntil]` | Background processing lifecycle (START/DONE/CRASHED) |
| `[Upload]` | File upload + RAG trigger decision |
| `[Kreuzberg]` | WASM initialization (success or failure at Worker startup) |
| `[ChatRoom]` | Durable Object operations including document-indexed notifications |

**Health signals:**
- `[Kreuzberg] WASM initialized, version: X.X.X` on every cold start — if missing, Office extraction is broken
- `[RAG:waitUntil] CRASHED` — extraction failed; check the error following this line
- `processing_timeout` errors accumulating — may indicate Worker CPU limits being hit

### OCR Status

**Current state:** Disabled. Neither unpdf nor Kreuzberg WASM handles `image/*` types. The UI toggle, API endpoints (`GET/PATCH/POST /api/rooms/[roomId]/ocr`), and org metadata flag exist but extraction will silently fail.

**Planned approach:** Workers AI Vision (`@cf/meta/llama-3.2-11b-vision-instruct`) — no new dependencies, already have the `AI` binding. Would extract text via vision prompt. Not yet implemented.

## Dependencies

| Dependency | Purpose | Size Impact |
|------------|---------|-------------|
| `unpdf` | PDF text extraction (serverless PDF.js) | ~500 KB (lazy-loaded in `waitUntil`) |
| `@kreuzberg/wasm` | DOCX/XLSX/PPTX extraction (manual wasm-bindgen init) | ~7.5 MB gzipped WASM (loaded in `worker-entry.ts`) |

> **Worker size:** ~9.3 MB gzipped with Kreuzberg WASM (Cloudflare paid plan limit: 10 MB). Monitor size when adding dependencies.

The pipeline also uses Workers AI for embeddings and Cloudflare Vectorize for vector search (no additional npm dependencies).

## Billing Impact

Current caps (from `ai-billing.ts`) already meter `doc_process` and `vector_query` operations. Both unpdf and Kreuzberg WASM extraction run inside the existing `processDocument()` pipeline, so no new billing category is needed.

Considerations:
- Large documents (100+ page PDFs) consume more Worker CPU time — 120s timeout mitigates
- Kreuzberg WASM adds ~7.5 MB to Worker size — near the 10 MB limit
- OCR is significantly more expensive — consider separate OCR usage counter if it becomes popular

## Risks & Known Issues

| Risk | Mitigation | Status |
|------|-----------|--------|
| WASM library compatibility on Workers | Manual wasm-bindgen init for Kreuzberg (Office); unpdf for PDF (no WASM) | **Resolved** |
| WASM CPU limits in Workers | 120s extraction timeout; skip + mark failed on timeout | **Active** — some large PDFs still timeout |
| Vectorize metadata filtering silently fails | Must create metadata index before upserting vectors; re-upsert after index creation | **Resolved** |
| Cron retry creates infinite duplicate jobs | Fixed with attachment-level retry + active job guard | **Resolved** |
| Archive bombs (zip of zips) | Cap extracted text at 1 MB; cap archive depth at 1 level | Planned |
| Worker size near limit | Kreuzberg WASM adds ~7.5 MB; total ~9.3 MB of 10 MB limit | **Active** — monitor when adding deps |
| OCR cost explosion | OCR is opt-in per room; metered under existing AI caps | Planned |
| Multi-room agent org resolution | Agents send `x-org-id` header; server validates against membership | **Resolved** |

---

## Development History

## Implementation Phases

### Phase 1: PDF Extraction + Pipeline Hardening

**Goal:** PDFs actually get extracted and indexed.

- [x] Install `@kreuzberg/wasm` as a dependency — `862cea0`
- [x] Create `kreuzberg-provider.ts` implementing `ExtractionProvider` — `862cea0`
- [x] Register Kreuzberg provider in the ingestion pipeline (replaces PDF stub) — `862cea0`
- [x] Replace Kreuzberg WASM with unpdf (Kreuzberg failed on Workers) — `d204692`
- [x] Fix DB connection for waitUntil RAG processing — `f7ab3fb`
- [x] Fix Hyperdrive client double-connect — `2140777`
- [x] Make ingestion_jobs insert non-fatal — `c9f024b`
- [x] Add extraction timeout + structured error codes — `6806996`
- [x] Fix cron: stuck job cleanup, orphan dispatch, retry backoff — `085b126`
- [x] Fix cron: prevent duplicate job creation in retry logic — `9911d40`
- [x] Increase cron frequency from hourly to every 5 minutes — `f98de86`
- [x] Create Vectorize metadata index on `orgId` (required for filtered search) — manual CLI
- [x] Test with PDF uploads — extraction, chunking, embedding, search all work ✅
- [x] Verify `doc_search` MCP tool returns PDF results to agents ✅ (2026-03-12)

### Phase 2: Expanded Format Support

**Goal:** Users can upload Office docs, HTML, email, archives.

- [x] Expand `ALLOWED_TYPES` set with all supported MIME types — `862cea0`
- [x] Add magic byte signatures for new types (ZIP-based formats, TIFF, gzip) — `862cea0`
- [x] Update `ChatInput.svelte` file picker `accept` attribute to include new types — `862cea0`
- [x] Update upload quota logic (file size limit bumped 10→25 MB for documents) — `862cea0`
- [x] Remove email/archive types from `PARSEABLE_TYPES` (no extraction provider)
- [x] Add DOCX/XLSX/PPTX extraction via Kreuzberg WASM — `b0a93fb`

### Phase 3: Document Panel UI

**Goal:** Users can see and manage their room's documents.

- [x] Create `DocumentPanel.svelte` — slide-out sidebar listing room attachments — `00ced5c`
- [x] File type icons (by MIME type category) — `00ced5c`
- [x] Status badges: pending, processing, indexed, failed, skipped — `00ced5c`
- [x] Delete button (owner/lead role gated) — `00ced5c`
- [x] Retry button for failed extractions + `POST /api/upload/files/retry` endpoint — `00ced5c`
- [x] Wire panel toggle into `ChatHeader.svelte` (document icon button) — `00ced5c`

### Phase 4: User Search UI

**Goal:** Users can semantically search room documents.

- [x] Add search input to DocumentPanel — `00ced5c`
- [x] Create `GET /api/rooms/[roomId]/documents/search?q=...` endpoint using existing `searchDocuments()` — `00ced5c`
- [x] Search results with snippet preview, score, filename, char range — `00ced5c`
- [x] AI usage metering for user searches (same `vector_query` counter) — `1f1fc1b`
- [x] Debounced search-as-you-type — `00ced5c`

### Phase 5: Citation Rendering

**Goal:** Agent responses show interactive document citations.

- [x] Define citation format convention: `[📄 filename.ext]` — `7f5e410`
- [x] Update `doc_search` MCP tool response to include `citation` field + `citation_instructions` — `7f5e410`
- [x] Add citation link renderer in `markdown.ts` — detect `[📄 ...]` patterns, render as styled badges — `7f5e410`
- [x] Citation click: opens DocumentPanel with search pre-filled via custom event — `7f5e410`
- [x] Update agent system prompt + tool definitions in martol-client to include doc_search with citation instructions

### Phase 6: Image OCR (Opt-in) — Partially Broken

**Goal:** Room owners can enable OCR for image uploads.

- [x] Add `ocrEnabled` flag to org metadata JSON (no migration needed) — `c10583a`
- [x] ~~When enabled, upload endpoint sets `processingStatus: 'pending'` for images~~ — disabled, unpdf has no OCR
- [ ] ~~Kreuzberg provider handles `image/*` types with OCR extraction~~ — **broken**: neither unpdf nor Kreuzberg WASM handles image/* types
- [x] "Index images" bulk action via `POST /api/rooms/[roomId]/ocr` — `c10583a` (endpoint exists but will fail)
- [x] Room settings UI toggle in DocumentPanel (owner/lead only) — `c10583a` (UI exists but non-functional)

> **Status:** The UI toggle and API endpoints exist but OCR extraction is non-functional — neither unpdf nor Kreuzberg WASM handles `image/*` types. The upload endpoint OCR code path is disabled. See [OCR Status](#ocr-status).

## Changelog

### 2026-03-13 — Kreuzberg WASM Integration for Office Formats

- **feat:** DOCX/XLSX/PPTX extraction via Kreuzberg WASM on Cloudflare Workers
- **spike:** Confirmed `initWasm()` fails on Workers (import.meta.url issue), but manual wasm-bindgen init works
- **impl:** Static WASM import + manual instantiation in `worker-entry.ts`, exposed via `globalThis.__kreuzbergBg`
- **impl:** Updated `kreuzberg-provider.ts` to route Office MIME types through Kreuzberg WASM
- **impl:** Added Office MIME types to `PARSEABLE_TYPES` in upload endpoint
- **docs:** Updated Lessons Learned to note `initWasm()` was never tried (it was — it fails)
- **note:** PDF still uses unpdf (Kreuzberg PDF requires PDFium which adds ~4MB WASM)
- **note:** Worker size: ~9.3MB gzipped (limit 10MB) — Kreuzberg WASM is ~7.5MB

### 2026-03-12 — Audit & Correctness Fixes

- **fix:** Remove EML/archive from `PARSEABLE_TYPES` — no extraction provider exists (DOCX/XLSX/PPTX re-added 2026-03-13)
- **fix:** Disable OCR image code path in upload endpoint — unpdf has no OCR capability
- **fix:** Increase extraction timeout from 30s to 60s, then to 120s (`fa6413d`) — moderate/large PDFs were timing out
- **fix:** Add ingestion jobs purge to cron (delete completed/failed jobs > 30 days)
- **fix:** Recover 4 wrongly-failed attachments (had chunks but were marked failed by stuck-job cleanup)
- **docs:** Update spec to reflect actual supported formats, mark Phase 6 as broken, add future plan for DOCX + OCR

### 2026-03-12 — Pipeline Hardening & doc_search Fix

- **fix:** Replace Kreuzberg WASM with unpdf for PDF extraction — `d204692`
- **fix:** Create Vectorize metadata index on `orgId` for filtered search — manual CLI
- **fix:** Accept `x-org-id` header in MCP auth for multi-room agents — `83d38ff`
- **fix:** Prevent duplicate ingestion jobs in cron retry logic — `9911d40`
- **fix:** Run RAG cron every 5 minutes instead of hourly — `f98de86`
- **fix:** Create dedicated DB connection for waitUntil RAG processing — `f7ab3fb`
- **fix:** Use connectPromise instead of double-connecting Hyperdrive client — `2140777`
- **fix:** Make ingestion_jobs insert non-fatal — `c9f024b`
- **debug:** Add MCP auth and doc_search logging — `3e1d101` (temporary — should be removed)
- **verified:** doc_search returns PDF results to agents via SDK MCP tool ✅
- **data:** Re-indexed all documents after Vectorize metadata index creation; 11 of 18 documents indexed, 5 failing with `processing_timeout` (large PDFs), 2 permanently skipped (JPEG, GIF)

### 2026-03-10 — Initial Implementation (Phases 1–6)

- **feat:** Kreuzberg WASM provider for PDF extraction — `862cea0` (later replaced)
- **feat:** Document panel UI with search — `00ced5c`
- **feat:** Citation rendering in agent responses — `7f5e410`
- **feat:** AI usage metering for document search — `1f1fc1b`
- **feat:** OCR opt-in per room — `c10583a`
- **feat:** Room notification on document indexed — `e1656bd`
- **feat:** Stuck job cleanup + orphan dispatch + retry backoff — `085b126`
- **fix:** Structured error codes in extraction pipeline — `6806996`

## Lessons Learned

### Kreuzberg WASM — Rescued via Manual wasm-bindgen Init

`@kreuzberg/wasm` was the original plan for all document extraction. It failed through **four successive attempts** before being replaced with `unpdf` for PDFs. A spike test (`148505e`) then confirmed that manual wasm-bindgen initialization works on Workers, leading to Kreuzberg being re-integrated for Office formats (`b0a93fb`).

**Attempts that failed:**

1. **Dynamic import** (`f4eea87`) — `import('@kreuzberg/wasm')` failed; Vite couldn't resolve WASM
2. **Explicit WASM module passing** (`901923e`) — passed binary explicitly; init still failed
3. **Global WASM in worker-entry.ts** (`fa25221`) — opaque errors from wasm-bindgen glue
4. **`initWasm()`** (`148505e` spike) — fails because `import.meta.url` is not a valid URL after Wrangler bundling; the glue file's top-level `fetch()` hangs on Workers

**What worked: manual wasm-bindgen initialization**

Instead of calling `initWasm()`, bypass it entirely:
1. Static import the `.wasm` binary (Wrangler handles natively)
2. Import `kreuzberg_wasm_bg.js` (the raw glue, not the auto-loading `kreuzberg_wasm.js`)
3. Build the `WebAssembly.Imports` object manually with 3 namespaces:
   - `./kreuzberg_wasm_bg.js` — the 110+ wasm-bindgen glue functions
   - `env` — `system()` and `mkstemp()` stubs (return -1)
   - `wasi_snapshot_preview1` — 17 WASI stubs (clock, RNG, filesystem no-ops)
4. Call `WebAssembly.instantiate(wasmModule, imports)`
5. Wire memory via `kreuzbergBg.__wbg_set_wasm(instance.exports)`
6. Call `__wbindgen_start()` if present (initializes Rust runtime)
7. Expose via `globalThis.__kreuzbergBg` for SvelteKit routes to consume

**Why not Kreuzberg for PDFs?** Kreuzberg's PDF extraction requires a separate PDFium Emscripten module (~4 MB WASM) which would push the Worker over the 10 MB limit. `unpdf` (serverless PDF.js) handles PDFs without additional WASM.

**Takeaway:** When a wasm-bindgen library's `initWasm()` fails on Workers, the manual instantiation pattern (static WASM import + `__wbg_set_wasm()`) is a reliable fallback. The key insight is importing the `_bg.js` file (raw glue without auto-loading) instead of the main entry point.

### Vectorize Metadata Indexes Must Be Created Before Upsert

Cloudflare Vectorize supports metadata filtering (e.g., `filter: { orgId: "..." }`), but this requires a **metadata index** to be explicitly created on the property:

```bash
npx wrangler vectorize create-metadata-index martol-docs --property-name orgId --type string
```

**Critical:** Vectors upserted *before* the metadata index was created are **not included** in the index. They must be re-upserted (delete + re-insert) after index creation. This caused `doc_search` to silently return 0 results for weeks despite documents being successfully embedded and stored.

**Takeaway:** Create Vectorize metadata indexes before any data is upserted, and document required indexes in deployment runbooks.

### Multi-Room Agents Need Explicit Org Context

The MCP auth system resolves an agent's org from the `member` table. When an agent belongs to multiple rooms, the query returns an arbitrary match. The fix was:

1. Client extracts `room_id` from the WebSocket URL (`/api/rooms/{id}/ws`)
2. Client sends `x-org-id` header with every MCP HTTP call
3. Server uses `orgIdHint` to filter the member query to the correct room

Commits: `83d38ff` (server), martol-client `base_wrapper.py` (client)

### Cron Retry Logic Must Be Idempotent

The original cron retry had a subtle double-dispatch bug: it reset the old failed job to `pending` AND called `processDocument()` which creates a new `running` job. This meant every 5-minute cron cycle created ~10 duplicate jobs, accumulating to 136+ jobs within an hour.

The fix (`9911d40`) rewrote retry to query by **attachment** (not job), count total attempts across all jobs for that attachment, and guard against dispatching when any active job exists.

**Takeaway:** When a function both updates state and triggers a side-effect that also updates state, you get double-writes. Design cron jobs to be idempotent — running them N times should have the same effect as running once.

### Agent SDK MCP Tool Integration

For the Claude Code agent wrapper (`martol-client`), `doc_search` was initially implemented as a fenced-block interception pattern (agent outputs a code block, wrapper intercepts and calls MCP). This was fragile — the agent often didn't format the block correctly.

The working approach uses the Claude Agent SDK's native `@tool` decorator + `create_sdk_mcp_server()` to register `doc_search` as a proper MCP tool that appears in Claude's tool list. The agent calls it natively like any other tool.

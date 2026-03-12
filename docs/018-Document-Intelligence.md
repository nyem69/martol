# Document Intelligence

**Date:** 2026-03-10 (updated 2026-03-12)
**Status:** Implemented (Phase 1–6 complete, hardening in progress)
**Depends on:** 006-Image-Upload (implemented), existing RAG pipeline (implemented)

## Summary

Upgrade Martol from basic file storage to a full document intelligence system. Users and agents upload documents (PDF, text, HTML, JSON, YAML, XML), Martol extracts text via unpdf (for PDFs) or direct decoding (for text types), chunks and embeds it, then serves semantic search with citations. A new document panel lets users browse, search, and manage room documents directly. Office formats (DOCX/XLSX/PPTX) and images (OCR) are accepted for upload/storage but not yet parsed — see [Future: DOCX & OCR Support](#future-docx--ocr-support).

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
| Office/HTML/email/archive support | **Upload-only** | Accepted for storage; extraction requires new providers — see future plan |
| Vectorize metadata index | **Done** | Required for org-scoped filtering — created manually |

**Remaining gaps:** DOCX/Office extraction needs a new provider (unpdf is PDF-only). Images require an OCR-capable provider (Phase 6 UI exists but backend is non-functional). See [Future: DOCX & OCR Support](#future-docx--ocr-support).

## Architecture

### Extraction Layer — unpdf

> **Historical note:** The original plan was to use `@kreuzberg/wasm` for all document types. This failed in production — see [Lessons Learned](#lessons-learned) below. We replaced it with `unpdf` (serverless PDF.js) which works reliably on Cloudflare Workers.

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
  |                    |
  |  text/plain,       |  PDF
  |  text/markdown,    |  -> unpdf (serverless PDF.js)
  |  text/csv, HTML,   |
  |  JSON, YAML, XML   |
  |  -> TextDecoder     |
  |                    |
  v                    v
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

**Upload-only** (stored in R2 but NOT parsed — no extraction provider):

| Category | Formats | MIME Types |
|----------|---------|------------|
| Office | DOCX, XLSX, PPTX, ODT | `application/vnd.openxmlformats-officedocument.*`, `application/vnd.oasis.opendocument.*` |
| Email | EML | `message/rfc822` |
| Archives | ZIP, gzip | `application/zip`, `application/gzip` |
| Images | JPEG, PNG, GIF, WebP, TIFF | `image/*` (OCR disabled — see future plan) |

### User-Facing Document UI

#### Document Panel (sidebar)

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

#### User Search

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

#### Citation Rendering in Agent Responses

When agents use `doc_search` and include results, the response can contain citation markers that render as interactive references:

Agent message:
> The deployment uses blue-green rollouts [quarterly-report.pdf, p.14]. The team agreed on phased deployment [meeting-notes.docx, §3].

Citations rendered as clickable links that:
- Highlight the source in the document panel
- Show the full chunk in a tooltip/popover
- Link to the document download

**Implementation:** The MCP `doc_search` tool already returns `filename`, `chunkIndex`, `charStart`, `charEnd`, and `score`. Agents can format citations naturally. The client-side markdown renderer can detect `[filename.ext, ...]` patterns following search results and render them as interactive citation links.

### OCR Strategy (Currently Disabled)

OCR for images was designed around Kreuzberg's built-in Tesseract WASM. Since Kreuzberg was replaced with unpdf (PDF-only), OCR is non-functional. The UI toggle, API endpoints, and org metadata flag still exist but the extraction backend cannot process images.

- **Default:** Images are stored but NOT OCR-processed (`processingStatus: 'skipped'`)
- **Opt-in toggle:** Exists in UI but extraction will not run (code path disabled in upload endpoint)
- **Re-enabling requires:** A new OCR-capable provider — see [Future: DOCX & OCR Support](#future-docx--ocr-support)

### Cron Retry Logic (Fixed)

The cron (`worker-entry.ts`) runs every 5 minutes and handles:

1. **Stuck job cleanup** — marks `running` jobs older than 5 minutes as `failed` with `processing_timeout`
2. **Pending dispatch** — finds `pending` attachments with no active (`running`/`pending`) ingestion job and dispatches them
3. **Failed retry** — finds `failed` attachments with < 3 total attempts (across all jobs) and no active job, then re-dispatches with backoff (1min after 1st failure, 5min after 2nd)

> **Critical bug fixed (`9911d40`):** The original retry logic had two cascading bugs: (1) it reset the old failed job to `pending` AND called `processDocument()` which creates a new `running` job — double job creation every cycle; (2) no guard against already-indexed attachments. This caused ~10 junk jobs per cron cycle, accumulating to 136+ within an hour. The fix queries by attachment (not individual job), counts total attempts across all jobs, and skips attachments with any active job.

## Schema Changes

### Expand `ALLOWED_TYPES` in upload endpoint

Add all Kreuzberg-supported MIME types to the upload allowlist. Magic byte validation needs corresponding signatures for new types, or delegate validation to Kreuzberg itself (it validates format integrity during extraction).

### Add room settings for OCR

```sql
ALTER TABLE organization ADD COLUMN ocr_enabled BOOLEAN NOT NULL DEFAULT false;
```

Or store in `organization.metadata` JSON to avoid a migration for a single flag.

### No other schema changes needed

The existing `attachments`, `document_chunks`, `ingestion_jobs`, and `ai_usage` tables already have all required columns including `parserName`, `parserVersion`, `extractedTextBytes`, `contentSha256`, `extractedAt`, `indexedAt`, `extractionErrorCode`, `charStart`, `charEnd`, `embeddingModel`, `embeddingDim`, and `chunkHash`.

## Implementation Plan

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
- [x] Remove Office/email/archive types from `PARSEABLE_TYPES` (no extraction provider) — `next commit`
- [ ] Add DOCX extraction provider — see [Future: DOCX & OCR Support](#future-docx--ocr-support)

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
- [ ] ~~Kreuzberg provider handles `image/*` types with OCR extraction~~ — **broken**: Kreuzberg was replaced with unpdf which is PDF-only
- [x] "Index images" bulk action via `POST /api/rooms/[roomId]/ocr` — `c10583a` (endpoint exists but will fail)
- [x] Room settings UI toggle in DocumentPanel (owner/lead only) — `c10583a` (UI exists but non-functional)

> **Status:** The UI toggle and API endpoints exist but OCR extraction is non-functional since Kreuzberg was replaced with unpdf. The upload endpoint OCR code path is disabled. See [Future: DOCX & OCR Support](#future-docx--ocr-support).

## Future: DOCX & OCR Support

Two extraction capabilities are missing since Kreuzberg was replaced with unpdf:

### DOCX/Office Extraction

**Problem:** DOCX, XLSX, PPTX files are accepted for upload but stored as-is — no text extraction, no RAG indexing.

**Candidate solutions:**

| Library | Formats | Workers-compatible? | Notes |
|---------|---------|---------------------|-------|
| `mammoth` | DOCX → HTML | Yes (pure JS) | Well-maintained, DOCX only |
| `xlsx` (SheetJS) | XLSX, CSV | Yes (pure JS) | Large bundle; community edition |
| `officeparser` | DOCX, XLSX, PPTX, ODT | Needs testing | Uses JSZip internally |

**Recommended approach:** Add `mammoth` for DOCX first (most common Office upload). Register as a new provider in `kreuzberg-provider.ts` or a separate `office-provider.ts`. XLSX/PPTX can follow later.

**Implementation:**
1. `pnpm add mammoth`
2. Add `application/vnd.openxmlformats-officedocument.wordprocessingml.document` to provider's SUPPORTED_TYPES
3. Add extraction path: `mammoth.extractRawText({ arrayBuffer })` → text
4. Re-add DOCX to `PARSEABLE_TYPES` in upload endpoint
5. Test with existing failed DOCX uploads

### Image OCR

**Problem:** The OCR UI toggle and API endpoints exist but the extraction backend can't process images.

**Candidate solutions:**

| Approach | How | Workers-compatible? | Notes |
|----------|-----|---------------------|-------|
| Workers AI Vision | `@cf/meta/llama-3.2-11b-vision-instruct` | Yes (native binding) | Already have `AI` binding; extract text via vision prompt |
| Tesseract.js WASM | `tesseract.js` | Risky (WASM) | Same WASM issues as Kreuzberg |
| External OCR API | Google Vision, AWS Textract | Yes (HTTP call) | Adds external dependency + cost |

**Recommended approach:** Use Workers AI Vision model — no new dependencies, already have the `AI` binding. Send image with prompt "Extract all text from this image" and use the response as extracted text. Much simpler than WASM-based Tesseract.

**Implementation:**
1. Add `image/*` types to provider's SUPPORTED_TYPES (gated by OCR check)
2. Call `env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { image: [...], prompt: '...' })`
3. Re-enable OCR code path in upload endpoint
4. Test with existing image uploads

## Dependencies

| Dependency | Purpose | Size Impact |
|------------|---------|-------------|
| `unpdf` | PDF text extraction (serverless PDF.js) | ~500 KB (lazy-loaded in `waitUntil`) |

> `@kreuzberg/wasm` was removed — it failed on Cloudflare Workers due to WASM initialization issues. See [Lessons Learned](#lessons-learned).

No other new dependencies. The pipeline already uses Workers AI for embeddings and Cloudflare Vectorize for vector search.

## Billing Impact

Current caps (from `ai-billing.ts`) already meter `doc_process` and `vector_query` operations. Kreuzberg extraction runs inside the existing `processDocument()` pipeline, so no new billing category is needed.

Considerations for expanded formats:
- Large documents (100+ page PDFs, archive bundles) consume more Worker CPU time
- Consider adding a max file size per type (e.g., 50 MB for archives, 25 MB for Office docs)
- OCR is significantly more expensive — consider separate OCR usage counter if it becomes popular

## Risks

| Risk | Mitigation | Status |
|------|-----------|--------|
| WASM library compatibility on Workers | Replaced Kreuzberg with unpdf after multiple WASM init failures | **Resolved** |
| WASM CPU limits in Workers | 30s extraction timeout; skip + mark failed on timeout | **Active** — some large PDFs still timeout |
| Vectorize metadata filtering silently fails | Must create metadata index before upserting vectors; re-upsert after index creation | **Resolved** |
| Cron retry creates infinite duplicate jobs | Fixed with attachment-level retry + active job guard | **Resolved** |
| Archive bombs (zip of zips) | Cap extracted text at 1 MB; cap archive depth at 1 level | Planned |
| DOCX/Office extraction not supported | unpdf is PDF-only; need a separate provider for Office formats | **Open** |
| OCR cost explosion | OCR is opt-in per room; metered under existing AI caps | Planned |
| Multi-room agent org resolution | Agents send `x-org-id` header; server validates against membership | **Resolved** |

## Lessons Learned

### Kreuzberg WASM — Abandoned Prematurely?

`@kreuzberg/wasm` was the original plan for document extraction. It failed through **four successive attempts**, all using custom/manual WASM loading:

1. **Dynamic import** (`f4eea87`) — `import('@kreuzberg/wasm')` failed; Vite/Workers couldn't resolve the WASM module
2. **Explicit WASM module passing** (`901923e`) — tried passing the WASM binary explicitly; initialization still failed
3. **Global WASM in worker-entry.ts** (`fa25221`) — loaded WASM at the worker top level and passed it through; WASM init failed with opaque errors
4. **Gave up on Kreuzberg** (`d204692`) — replaced entirely with `unpdf`, which is built specifically for serverless/edge runtimes

**What was never tried:** The official Cloudflare Workers WASM initialization pattern — calling `await initWasm()` explicitly before `extractBytes()`. All four attempts used custom WASM wiring instead of the documented path. The `@kreuzberg/wasm` package exports `initWasm()` specifically for non-Node environments, and this was the most likely correct approach.

**Spike test recommended:** Before permanently abandoning Kreuzberg (which would unlock DOCX, XLSX, PPTX, and OCR support), test a minimal isolated Worker endpoint: latest `@kreuzberg/wasm`, top-level cached `initPromise` or guarded `initWasm()`, one tiny PDF, `extractBytes(bytes, 'application/pdf')`, no OCR, no Office, no abstraction layer. If this works, the extraction layer can be significantly expanded.

**Takeaway:** When a WASM library fails on Workers, try the library's **official documented initialization path** first before resorting to manual WASM wiring. Only abandon the library if the official path explicitly fails.

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

## Changelog

### 2026-03-12 — Audit & Correctness Fixes

- **fix:** Remove DOCX/XLSX/PPTX/EML/archive from `PARSEABLE_TYPES` — no extraction provider exists
- **fix:** Disable OCR image code path in upload endpoint — unpdf has no OCR capability
- **fix:** Increase extraction timeout from 30s to 60s — moderate PDFs were timing out
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
- **debug:** Add MCP auth and doc_search logging — `3e1d101`
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

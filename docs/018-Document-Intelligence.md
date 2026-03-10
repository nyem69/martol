# Document Intelligence

**Date:** 2026-03-10
**Status:** Proposed
**Depends on:** 006-Image-Upload (implemented), existing RAG pipeline (implemented)

## Summary

Upgrade Martol from basic file storage to a full document intelligence system. Users and agents upload documents (PDF, Office, HTML, email, archives, images with OCR), Martol extracts text via Kreuzberg, chunks and embeds it, then serves semantic search with citations. A new document panel lets users browse, search, and manage room documents directly.

## Current State

The RAG pipeline is already built end-to-end:

| Component | Status | Notes |
|-----------|--------|-------|
| Upload API (R2 + auth + quotas) | Done | `POST /api/upload` with magic byte validation |
| Attachments table (full metadata) | Done | `parserName`, `contentSha256`, `extractedAt`, etc. |
| Async ingestion pipeline | Done | `processDocument()` via `ctx.waitUntil()` |
| Pluggable parser interface | Done | `ExtractionProvider` with `registerProvider()` |
| Text/Markdown extraction | Done | `builtin-text` provider |
| PDF extraction | **Stub** | Returns null — "Kreuzberg Phase 2" comment |
| Chunker (word-boundary, offsets) | Done | 500-word windows, 50-word overlap, char offsets |
| Embedder (BGE-base-en-v1.5) | Done | 768-dim, Workers AI, batch embed + Vectorize upsert |
| Document chunks table | Done | `vectorId`, `charStart`/`charEnd`, `embeddingModel` |
| Ingestion jobs table | Done | Job tracking with retry support |
| AI usage metering | Done | Daily counters per org, cap enforcement |
| Semantic search | Done | Vectorize query with org filter + DB chunk join |
| MCP `doc_search` tool | Done | Agent-facing search with cap check |
| Cron retry for failed jobs | **Partial** | Resets status but doesn't re-dispatch |
| File delete (R2 + vectors + DB) | Done | Owner/lead only, full cascade |
| User-facing document UI | **Missing** | No document panel, search, or citations |
| Office/HTML/email/archive support | **Missing** | Only `image/*`, `application/pdf`, `text/plain` allowed |

**Key gap:** The entire pipeline works for text/markdown files. PDFs are accepted but silently skipped. No other document types are allowed. No user-facing search or document management UI exists.

## Architecture

### Extraction Layer — Kreuzberg

Replace the PDF stub and expand format support using `@kreuzberg/wasm`:

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
  |  text/plain,       |  PDF, DOCX, XLSX, PPTX, HTML,
  |  text/markdown     |  email, archives, images (OCR)
  |  -> builtin-text   |  -> @kreuzberg/wasm
  |                    |
  v                    v
ExtractionResult { text, parserName, parserVersion, contentSha256, pageCount }
  |
  v
chunkText() -> embedAndIndex() -> documentChunks + Vectorize
```

The `builtin-text` provider remains for plain text/markdown (no need for Kreuzberg overhead on trivial formats). Kreuzberg handles everything else.

### Supported Formats (via Kreuzberg)

| Category | Formats | MIME Types |
|----------|---------|------------|
| Documents | PDF, DOCX, PPTX, ODT | `application/pdf`, `application/vnd.openxmlformats-officedocument.*`, `application/vnd.oasis.opendocument.*` |
| Spreadsheets | XLSX, CSV | `application/vnd.openxmlformats-officedocument.spreadsheetml.*`, `text/csv` |
| Web | HTML, XML | `text/html`, `application/xml` |
| Data | JSON, YAML | `application/json`, `text/yaml` |
| Email | EML, MSG | `message/rfc822`, `application/vnd.ms-outlook` |
| Archives | ZIP, TAR, 7Z | `application/zip`, `application/x-tar`, `application/x-7z-compressed` |
| Images (OCR) | PNG, JPG, TIFF, WebP | `image/*` (when OCR enabled) |
| Text | Plain, Markdown, CSV | `text/plain`, `text/markdown`, `text/csv` |
| Academic | LaTeX, BibTeX, Jupyter | `application/x-tex`, `application/x-bibtex`, `application/x-ipynb+json` |

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

### OCR Strategy

OCR for images is gated separately because it's expensive:

- **Default:** Images are stored but NOT OCR-processed (current behavior — `processingStatus: 'skipped'`)
- **Opt-in per room:** Room owner enables "OCR image uploads" in room settings
- **On enable:** Existing image attachments can be batch-reprocessed via an "Index images" button
- **Kreuzberg handles OCR** via its built-in Tesseract WASM support — no separate OCR service needed

### Cron Retry Fix

The current cron resets failed jobs to `pending` but doesn't re-dispatch. Fix:

```typescript
// worker-entry.ts cron handler
const pendingJobs = await db.select(...)
  .from(ingestionJobs)
  .where(and(eq(status, 'pending'), lt(attemptCount, 3)));

for (const job of pendingJobs) {
  ctx.waitUntil(processDocument(db, ai, vectorize, r2, job.attachmentId, job.orgId));
}
```

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

### Phase 1: Kreuzberg Integration + PDF Support

**Goal:** PDFs actually get extracted and indexed.

- [x] Install `@kreuzberg/wasm` as a dependency — `862cea0`
- [x] Create `kreuzberg-provider.ts` implementing `ExtractionProvider` — `862cea0`
- [x] Register Kreuzberg provider in the ingestion pipeline (replaces PDF stub) — `862cea0`
- [ ] Test with PDF uploads — verify extraction, chunking, embedding, search all work
- [x] Fix cron retry to actually re-dispatch pending jobs — `next commit`
- [ ] Verify `doc_search` MCP tool returns PDF results to agents

### Phase 2: Expanded Format Support

**Goal:** Users can upload Office docs, HTML, email, archives.

- [x] Expand `ALLOWED_TYPES` set with all Kreuzberg-supported MIME types — `862cea0`
- [x] Add magic byte signatures for new types (ZIP-based formats, TIFF, gzip) — `862cea0`
- [x] Update `ChatInput.svelte` file picker `accept` attribute to include new types — `862cea0`
- [x] Update upload quota logic (file size limit bumped 10→25 MB for documents) — `862cea0`
- [ ] Test extraction across format categories: DOCX, XLSX, PPTX, HTML, EML, ZIP

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
- [ ] AI usage metering for user searches (same `vector_query` counter)
- [x] Debounced search-as-you-type — `00ced5c`

### Phase 5: Citation Rendering

**Goal:** Agent responses show interactive document citations.

- [x] Define citation format convention: `[📄 filename.ext]` — `7f5e410`
- [x] Update `doc_search` MCP tool response to include `citation` field + `citation_instructions` — `7f5e410`
- [x] Add citation link renderer in `markdown.ts` — detect `[📄 ...]` patterns, render as styled badges — `7f5e410`
- [x] Citation click: opens DocumentPanel with search pre-filled via custom event — `7f5e410`
- [ ] Update agent system prompt to instruct citation formatting when using doc_search results (client-side config)

### Phase 6: Image OCR (Opt-in)

**Goal:** Room owners can enable OCR for image uploads.

- [ ] Add `ocrEnabled` flag to room/org settings
- [ ] When enabled, set `processingStatus: 'pending'` for image uploads (instead of `'skipped'`)
- [ ] Kreuzberg provider handles `image/*` types with OCR extraction
- [ ] "Index images" bulk action for existing unprocessed image attachments
- [ ] Room settings UI toggle for OCR

## Dependencies

| Dependency | Purpose | Size Impact |
|------------|---------|-------------|
| `@kreuzberg/wasm` | Document extraction engine | ~2-5 MB WASM bundle (loaded on demand in `waitUntil`) |

No other new dependencies. The pipeline already uses Workers AI for embeddings and Cloudflare Vectorize for vector search.

## Billing Impact

Current caps (from `ai-billing.ts`) already meter `doc_process` and `vector_query` operations. Kreuzberg extraction runs inside the existing `processDocument()` pipeline, so no new billing category is needed.

Considerations for expanded formats:
- Large documents (100+ page PDFs, archive bundles) consume more Worker CPU time
- Consider adding a max file size per type (e.g., 50 MB for archives, 25 MB for Office docs)
- OCR is significantly more expensive — consider separate OCR usage counter if it becomes popular

## Risks

| Risk | Mitigation |
|------|-----------|
| `@kreuzberg/wasm` bundle size in Worker | Lazy-load only in `waitUntil()` ingestion path, not in request handler |
| WASM CPU limits in Workers | Extraction runs async; set 30s timeout per document; skip + mark failed on timeout |
| Kreuzberg WASM Cloudflare compatibility | Their changelog shows active Workers fixes; test before committing |
| Archive bombs (zip of zips) | Cap extracted text at 1 MB; cap archive depth at 1 level |
| Malicious Office docs (macro execution) | Kreuzberg extracts text only, doesn't execute macros |
| OCR cost explosion | OCR is opt-in per room; metered under existing AI caps |

## Changelog

_To be updated as phases are implemented._

# Design: docs/018-Document-Intelligence.md Restructure

**Date:** 2026-03-13
**Scope:** Housekeeping + operational reference + full restructure of docs/018

## Goals

1. **Housekeeping** — remove stale planning sections that describe already-shipped work
2. **Operational reference** — add deployment checklist, error codes, monitoring, cron details
3. **Restructure** — reorganize into "Current Reference" (top) and "Development History" (bottom)

## Approach

Single-file restructure with hard separation. Top half is operational reference for day-to-day use. Bottom half (after `---` divider) is historical record of how it was built.

## New Document Structure

```
# Document Intelligence

## Table of Contents                    ← NEW

## Summary                              ← EXISTS (minor refresh)

## Current State                        ← EXISTS (keep as-is)

## Architecture                         ← EXISTS (trimmed)
  ### Extraction Layer                   ← keep diagram + historical note
  ### Supported Formats                  ← keep both tables

## Document UI                          ← PROMOTED from Architecture sub-section
  ### Document Panel                     ← keep
  ### User Search                        ← keep
  ### Citation Rendering                 ← keep

## Operational Reference                ← NEW SECTION
  ### Deployment Checklist               ← NEW
  ### Cron Jobs                          ← MOVED from Architecture
  ### Error Codes                        ← NEW
  ### Monitoring                         ← NEW
  ### OCR Status                         ← MOVED+CONDENSED from OCR Strategy + Future

## Dependencies                         ← EXISTS (keep)
## Billing Impact                       ← EXISTS (keep)
## Risks & Known Issues                 ← EXISTS (renamed from "Risks")

---

## Development History                  ← DIVIDER + heading

## Implementation Phases                ← RENAMED from "Implementation Plan"
  ### Phase 1–6                          ← keep all checkboxes as historical record

## Changelog                            ← EXISTS (keep, 2 minor fixes)
## Lessons Learned                      ← EXISTS (keep)
```

## Deletions

| Section | Lines | Reason |
|---------|-------|--------|
| Schema Changes | 182-198 | All three subsections describe shipped work |
| OCR Strategy (Currently Disabled) | 164-170 | Replaced by condensed OCR Status in Operational Reference |
| Future: OCR Support (entire section) | 275-299 | DOCX subsection is "DONE" stub; OCR content absorbed into OCR Status |

## New Content: Operational Reference

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

Health signals:
- `[Kreuzberg] WASM initialized, version: X.X.X` on every cold start — if missing, Office extraction is broken
- `[RAG:waitUntil] CRASHED` — extraction failed; check the error following this line
- `processing_timeout` errors accumulating — may indicate Worker CPU limits being hit

### OCR Status

Current state: Disabled. Neither unpdf nor Kreuzberg WASM handles `image/*` types. The UI toggle, API endpoints (`GET/PATCH/POST /api/rooms/[roomId]/ocr`), and org metadata flag exist but extraction will silently fail.

Planned approach: Workers AI Vision (`@cf/meta/llama-3.2-11b-vision-instruct`) — no new dependencies, already have the `AI` binding. Would extract text via vision prompt. Not yet implemented.

## Moves

| Content | From | To |
|---------|------|----|
| Document Panel / User Search / Citations | Architecture > User-Facing Document UI | Top-level "Document UI" section |
| Cron Retry Logic | Architecture > Cron Retry Logic | Operational Reference > Cron Jobs |
| OCR info | OCR Strategy + Future sections | Operational Reference > OCR Status |

## Renames

| Current | New |
|---------|-----|
| Implementation Plan | Implementation Phases |
| Risks | Risks & Known Issues |

## Fixes in Existing Content

1. Phase 6 OCR strikethrough: "Kreuzberg was replaced with unpdf which is PDF-only" → "neither unpdf nor Kreuzberg WASM handles image/* types"
2. Changelog 2026-03-13: "PDFium adds ~2MB" → "~4MB"
3. Changelog debug entry `3e1d101`: add "(temporary — should be removed)"

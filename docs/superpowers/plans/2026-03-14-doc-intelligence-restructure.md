# docs/018 Document Intelligence Restructure — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure docs/018-Document-Intelligence.md into a clean current-state reference (top) + development history (bottom), removing stale planning sections and adding operational reference content.

**Architecture:** Single-file rewrite. The existing ~450-line doc gets reorganized into two halves separated by a `---` divider. New content (Operational Reference section) is inserted between existing sections. Stale sections are deleted. No code changes.

**Tech Stack:** Markdown only. No code, no tests, no dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-doc-intelligence-restructure-design.md`

---

## Chunk 1: Full Restructure

This is a single-chunk plan — the entire change is one file rewrite with logical steps.

### Task 1: Snapshot current state

**Files:**
- Read: `docs/018-Document-Intelligence.md`

- [ ] **Step 1: Read the full current doc**

Read `docs/018-Document-Intelligence.md` end-to-end to have the complete content in context.

- [ ] **Step 2: Verify current line references match spec**

Confirm the spec's line references still hold (Schema Changes ~182-198, OCR Strategy ~164-170, Future ~275-299). If the file has shifted since the spec was written, note the actual line numbers.

### Task 2: Write the restructured document

**Files:**
- Modify: `docs/018-Document-Intelligence.md` (full rewrite via Write tool)

The new file follows this exact section order. Each step below writes one logical section.

- [ ] **Step 3: Write header + Table of Contents**

```markdown
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
```

- [ ] **Step 4: Write Summary section**

Keep existing Summary text (line 9 of current doc). One fix: the anchor `[Future: OCR Support](#future-ocr-support)` must change to `[OCR Status](#ocr-status)` since the Future section is being deleted.

- [ ] **Step 5: Write Current State section**

Keep existing Current State table (lines 11-37 of current doc). One fix: line 37 contains `See [Future: OCR Support](#future-ocr-support)` — change to `See [OCR Status](#ocr-status)`.

- [ ] **Step 6: Write Architecture section (trimmed)**

Keep from current doc:
- "Extraction Layer — unpdf + Kreuzberg WASM" heading + historical note + ASCII diagram + provider note (lines 39-70)
- "Supported Formats" heading + both tables (lines 72-91). One fix: line 91 has `(OCR disabled — see future plan)` — change to `(OCR disabled — see [OCR Status](#ocr-status))`

**Remove** from Architecture:
- "User-Facing Document UI" subsection (moves to its own top-level section — Task 2 Step 7)
- "OCR Strategy (Currently Disabled)" subsection (moves to Operational Reference — Task 2 Step 9)
- "Cron Retry Logic (Fixed)" subsection (moves to Operational Reference — Task 2 Step 9)

- [ ] **Step 7: Write Document UI section (promoted)**

Take the existing "User-Facing Document UI" content (current lines 93-162) and promote it to a top-level `## Document UI` section. Keep all three subsections verbatim:
- Document Panel (sidebar)
- User Search
- Citation Rendering in Agent Responses

- [ ] **Step 8: Write Operational Reference — Deployment Checklist**

New section. Content exactly as specified in the design spec lines 68-96:

```markdown
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
```

- [ ] **Step 9: Write Operational Reference — Cron Jobs**

Move the cron operational description from current lines 172-178. Write as:

```markdown
### Cron Jobs

The cron (`worker-entry.ts`) runs every 5 minutes and handles:

1. **Stuck job cleanup** — marks `running` jobs older than 5 minutes as `failed` with `processing_timeout`
2. **Pending dispatch** — finds `pending` attachments with no active (`running`/`pending`) ingestion job and dispatches them
3. **Failed retry** — finds `failed` attachments with < 3 total attempts (across all jobs) and no active job, then re-dispatches with backoff (1min after 1st failure, 5min after 2nd)
```

**Do NOT include** the `> Critical bug fixed` blockquote here — it already exists in the Lessons Learned section ("Cron Retry Logic Must Be Idempotent", lines 387-393). No action needed to move it; just omit it from this operational section.

- [ ] **Step 10: Write Operational Reference — Error Codes**

New section:

```markdown
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
```

- [ ] **Step 11: Write Operational Reference — Monitoring**

New section:

```markdown
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
```

- [ ] **Step 12: Write Operational Reference — OCR Status**

New section (condensed from current OCR Strategy + Future sections):

```markdown
### OCR Status

**Current state:** Disabled. Neither unpdf nor Kreuzberg WASM handles `image/*` types. The UI toggle, API endpoints (`GET/PATCH/POST /api/rooms/[roomId]/ocr`), and org metadata flag exist but extraction will silently fail.

**Planned approach:** Workers AI Vision (`@cf/meta/llama-3.2-11b-vision-instruct`) — no new dependencies, already have the `AI` binding. Would extract text via vision prompt. Not yet implemented.
```

- [ ] **Step 13: Write Dependencies section**

Keep existing Dependencies content as-is (current lines 301-310). No changes.

- [ ] **Step 14: Write Billing Impact section**

Keep existing Billing Impact content as-is (current lines 312-319). No changes.

- [ ] **Step 15: Write Risks & Known Issues section**

Keep existing Risks table as-is (current lines 321-332), but rename heading from `## Risks` to `## Risks & Known Issues`.

- [ ] **Step 16: Write Development History divider**

```markdown
---

## Development History
```

- [ ] **Step 17: Write Implementation Phases section**

Rename from "Implementation Plan" to "Implementation Phases". Keep all Phase 1-6 content (current lines 200-273) with these fixes:

1. Phase 6 line 269: change `**broken**: Kreuzberg was replaced with unpdf which is PDF-only` → `**broken**: neither unpdf nor Kreuzberg WASM handles image/* types`
2. The `> Critical bug fixed` blockquote does NOT need to be moved here — the same content already exists in Lessons Learned ("Cron Retry Logic Must Be Idempotent"). Simply omit it.

- [ ] **Step 18: Write Changelog section**

Keep existing Changelog (current lines 401-447) with these fixes:

1. Line 411: change "PDFium which adds ~2MB WASM" → "PDFium which adds ~4MB WASM"
2. Line 433: change `- **debug:** Add MCP auth and doc_search logging — \`3e1d101\`` → `- **debug:** Add MCP auth and doc_search logging — \`3e1d101\` (temporary — should be removed)`

- [ ] **Step 19: Write Lessons Learned section**

Keep existing Lessons Learned content as-is (current lines 334-399). The cron bug-fix narrative already exists in the "Cron Retry Logic Must Be Idempotent" lesson (lines 387-393) — no additions needed.

### Task 3: Verify deletions

- [ ] **Step 20: Confirm stale sections are gone**

Verify the restructured file does NOT contain:
- "## Schema Changes" heading
- "## Future: OCR Support" heading (or "DOCX/Office Extraction — DONE")
- "### OCR Strategy (Currently Disabled)" heading
- "ALTER TABLE organization ADD COLUMN ocr_enabled" SQL block
- The text "Add all Kreuzberg-supported MIME types to the upload allowlist"

Search the written file for these strings and confirm zero matches.

- [ ] **Step 21: Verify section order**

Read the file and confirm headings appear in this exact order:
1. `# Document Intelligence`
2. `## Table of Contents`
3. `## Summary`
4. `## Current State`
5. `## Architecture`
6. `## Document UI`
7. `## Operational Reference`
8. `## Dependencies`
9. `## Billing Impact`
10. `## Risks & Known Issues`
11. `---`
12. `## Development History`
13. `## Implementation Phases`
14. `## Changelog`
15. `## Lessons Learned`

- [ ] **Step 22: Verify Table of Contents links**

Check that every `#anchor` in the TOC matches an actual heading in the document.

### Task 4: Commit

- [ ] **Step 23: Commit the restructured doc**

```bash
git add docs/018-Document-Intelligence.md
git commit -m "docs: restructure 018-Document-Intelligence into reference + history

- Add Table of Contents
- Add Operational Reference (deployment checklist, cron, error codes, monitoring, OCR status)
- Promote Document UI to top-level section
- Delete stale Schema Changes and Future sections
- Move Implementation Plan to Development History
- Fix PDFium size (2MB→4MB), mark debug logging as temporary

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

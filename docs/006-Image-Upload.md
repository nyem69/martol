# Image Upload

**Date:** 2026-03-04
**Status:** Partially implemented

## Summary

Users upload images (and PDFs/text files) to Cloudflare R2 via `POST /api/upload`. Images embed in chat messages using `![alt](r2:key)` body markers — zero schema change on the messages table, zero WebSocket protocol change. The upload API and lightbox modal are built; the client-side upload UI and inline rendering are not yet wired.

> **Design doc:** `docs/plans/2026-03-04-image-upload-stripe-design.md`

## Architecture

```
User selects file
  │
  ▼
POST /api/upload
  ├── Auth + membership check (viewers blocked)
  ├── Feature flag: ENABLE_UPLOADS === 'true'
  ├── Validate: type allowlist + magic bytes + 10 MB limit
  ├── Sanitize filename → {orgId}/{timestamp}-{safeName}
  └── Store in R2 with uploadedBy/orgId metadata
  │
  ▼
Returns { ok, key, filename, contentType, sizeBytes }
  │
  ▼
Client inserts ![filename](r2:{key}) into message textarea
  │
  ▼
Message sent through existing WS pipeline (body is plain text)
  │
  ▼
MessageBubble parses r2: markers → <img> thumbnails (NOT YET BUILT)
  │
  ▼
Click thumbnail → ImageModal lightbox (BUILT)
  ├── GET /api/upload?key={key} → serves file from R2
  └── Cache: private, max-age=3600, X-Content-Type-Options: nosniff
```

## Upload API

**Endpoint:** `src/routes/api/upload/+server.ts`

### POST — Upload file to R2

| Check | Detail |
|-------|--------|
| Feature flag | `ENABLE_UPLOADS` must be `'true'` |
| Auth | Session required, active org resolved |
| Role | Viewers cannot upload |
| File size | Max 10 MB |
| Content type | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain` |
| Magic bytes | Content-type spoofing prevention — verifies file header matches declared type |
| SVG | Intentionally excluded (stored XSS via embedded scripts) |

**R2 key format:** `{orgId}/{timestamp}-{sanitizedFilename}`

Filename sanitization: `file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128)`

**R2 metadata stored:**
```json
{
  "httpMetadata": { "contentType": "image/png", "contentDisposition": "attachment; filename=\"photo.png\"" },
  "customMetadata": { "uploadedBy": "user_abc123", "orgId": "org_xyz" }
}
```

### GET — Serve file from R2

| Check | Detail |
|-------|--------|
| Auth | Session required |
| Key format | Validated against `/^[\w-]+\/[\w][\w._-]*$/` (path traversal prevention) |
| Org access | Org ID extracted from key prefix, membership verified |
| Headers | `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600` |

## R2 Binding

**File:** `wrangler.toml`

```toml
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "opensesame"
preview_bucket_name = "opensesame"
remote = true
```

Typed in `src/app.d.ts` as `STORAGE: R2Bucket` with feature flag `ENABLE_UPLOADS: string`.

## Database Schema

**File:** `src/lib/server/db/schema.ts`

```
attachments
├── id            BIGSERIAL PK
├── message_id    BIGINT NOT NULL
├── org_id        TEXT NOT NULL
├── filename      TEXT NOT NULL
├── r2_key        TEXT NOT NULL
├── content_type  TEXT
├── size_bytes    BIGINT
└── created_at    TIMESTAMPTZ DEFAULT NOW()

Indexes: idx_attachments_message_id, idx_attachments_org_message
```

> **Note:** The design doc specifies `message_id` should be nullable (upload before message send) and an `uploaded_by` column should be added for quota counting. These schema changes are not yet applied.

## Message Encoding

Images are encoded as markdown image markers in the message body:

```
![photo.png](r2:org_abc/1709500000000-photo.png)
```

This approach means:
- No schema migration on the `messages` table
- No WebSocket protocol changes — the DO treats it as plain text
- The `r2:` prefix distinguishes uploaded files from external URLs
- Marker text is small (~80 chars), well within the 32 KB body limit

## Components

### ImageModal.svelte (built)

**File:** `src/lib/components/chat/ImageModal.svelte`

Full-screen lightbox for viewing images at full resolution. Supports:
- Backdrop click to close
- ESC key to close
- Close button (top-right)
- `max-h-[90vh] max-w-[90vw] object-contain` sizing

### PendingActionLine.svelte — not related (listed for contrast)

## Implementation Status

| Component | Status | File |
|-----------|--------|------|
| `POST /api/upload` | Built | `src/routes/api/upload/+server.ts` |
| `GET /api/upload?key=` | Built | `src/routes/api/upload/+server.ts` |
| R2 binding (`STORAGE`) | Built | `wrangler.toml`, `src/app.d.ts` |
| `ENABLE_UPLOADS` feature flag | Built | `src/app.d.ts` |
| Magic byte validation | Built | `src/routes/api/upload/+server.ts` |
| `attachments` table | Partial | `src/lib/server/db/schema.ts` |
| `ImageModal.svelte` | Built | `src/lib/components/chat/ImageModal.svelte` |
| `r2:` marker parsing in MessageBubble | Not built | `src/lib/components/chat/MessageBubble.svelte` |
| `img` in DOMPurify allowlist | Not built | `src/lib/utils/markdown.ts` |
| Image button in ChatInput | Not built | `src/lib/components/chat/ChatInput.svelte` |
| Drag-and-drop upload zone | Not built | — |
| Upload progress UI | Not built | — |
| Quota endpoint (`/api/upload/quota`) | Not built | — |
| Upgrade modal | Not built | — |
| Stripe checkout/webhooks/portal | Not built | — |
| `subscriptions` table | Not built | — |

## Security Considerations

- **No SVG uploads** — SVG can contain embedded `<script>` tags (stored XSS)
- **Magic byte verification** — prevents content-type spoofing (e.g. uploading HTML as `image/png`)
- **R2 key regex** — prevents path traversal attacks
- **Org-scoped access** — GET verifies the requesting user is a member of the org that owns the file
- **`nosniff` header** — prevents browsers from MIME-sniffing served files
- **`attachment` disposition** — forces download rather than inline execution for non-image types
- **Viewers blocked** — only members with upload capability (member, lead, owner) can upload

---

## Review Findings

**Reviewed:** 2026-03-04
**Agents:** Cloudflare infra, Database, Security, UI/UX, martol-client compatibility

### martol-client Compatibility

| Concern | Status | Notes |
|---------|--------|-------|
| Agent sees `r2:` markers | Passive — treats as opaque text | No code parses or renders image markers |
| Agent upload capability | Not implemented | No upload tools exposed; agents can't attach files |
| Vision API integration | Not implemented | No image-to-text pipeline for agent context |
| Context window bloat | Low risk | `r2:` markers are ~80 chars, well within limits |

**Verdict:** martol-client is inert w.r.t. image upload — no breakage, no capability. Agent image support is a future feature.

### Critical Findings

#### [S1] No upload rate limiting
**Severity:** Critical | **File:** `src/routes/api/upload/+server.ts`

No per-user rate limit on `POST /api/upload`. An authenticated user can exhaust R2 storage or rack up egress costs with rapid uploads.

**Fix:** Add `checkRateLimit(kv, { key: \`upload:\${userId}\`, maxRequests: 20, windowSeconds: 60 })` before processing.

#### [S2] `text/plain` bypasses magic byte validation
**Severity:** Critical | **File:** `src/routes/api/upload/+server.ts`

`text/plain` is in the allowed content types but has no magic byte check — any file with a `text/plain` Content-Type passes through. An attacker could upload an HTML file as `text/plain`, and if the GET endpoint ever serves it without `nosniff`, the browser would render it.

**Fix:** For `text/plain`, validate that the first 512 bytes contain no `<script`, `<html`, `<svg`, or `javascript:` sequences. Alternatively, drop `text/plain` from allowed types entirely.

#### [S3] GET endpoint trusts R2-stored Content-Type verbatim
**Severity:** Critical | **File:** `src/routes/api/upload/+server.ts`

`GET /api/upload?key=` reads the R2 object's `httpMetadata.contentType` and serves it directly. If an attacker manages to store a file with a malicious content type, the response inherits it. The `nosniff` header helps but doesn't cover all vectors.

**Fix:** Re-validate the stored content type against the allowlist before serving. Fall back to `application/octet-stream` for unknown types.

#### [D1] `message_id NOT NULL` blocks pre-send upload tracking
**Severity:** Critical | **File:** `src/lib/server/db/schema.ts`

The `attachments` table has `message_id BIGINT NOT NULL`, but the upload happens _before_ the message is sent (user uploads file → gets key → inserts marker into message body → sends). There's no `message_id` at upload time.

**Fix:** Make `message_id` nullable. After the message is persisted by the DO flush, backfill the attachment record with the real message ID.

#### [D2] Missing `uploaded_by` column
**Severity:** Critical | **File:** `src/lib/server/db/schema.ts`

The `attachments` table lacks `uploaded_by`. Without it, per-user storage quota counting requires scanning R2 metadata (infeasible at scale). The design doc specifies this column.

**Fix:** Add `uploaded_by TEXT NOT NULL` column with a foreign key to the user table.

#### [D3] Upload API never writes to `attachments` table
**Severity:** Critical | **File:** `src/routes/api/upload/+server.ts`

`POST /api/upload` stores the file in R2 and returns the key, but never inserts a row into the `attachments` table. This means:
- No DB record of what was uploaded
- No way to count per-user storage for quota enforcement
- No way to garbage-collect orphaned R2 objects
- No audit trail

**Fix:** Insert an `attachments` row (with `message_id = null`) immediately after successful R2 put. Backfill `message_id` when the message is persisted.

#### [D4] No `subscriptions` table
**Severity:** Critical (for Stripe integration) | **File:** `src/lib/server/db/schema.ts`

The Stripe subscription flow requires a `subscriptions` table to track plan tier, limits, and status. Not yet created.

**Fix:** Create the table when implementing Stripe integration (separate task).

### Important Findings

#### [I1] Preview and production share same R2 bucket
**Severity:** Important | **File:** `wrangler.toml`

`preview_bucket_name = "opensesame"` is the same as `bucket_name`. Developers running `wrangler dev` will read/write production R2 objects.

**Fix:** Create a separate `opensesame-dev` bucket and set `preview_bucket_name = "opensesame-dev"`.

#### [I2] `ENABLE_UPLOADS` not checked on GET
**Severity:** Important | **File:** `src/routes/api/upload/+server.ts`

The feature flag gates uploads but not downloads. If uploads are disabled, previously uploaded files remain accessible — which may be intentional, but should be documented.

**Fix:** Document this as intentional (uploaded files remain accessible after feature is disabled), or add the flag check to GET as well.

#### [I3] `Content-Disposition: attachment` blocks inline image display
**Severity:** Important | **File:** `src/routes/api/upload/+server.ts`

All files are served with `Content-Disposition: attachment`, which forces a download dialog. For images displayed inline via `<img>` tags, the browser needs `inline` disposition.

**Fix:** Serve image types (`image/*`) with `Content-Disposition: inline` and non-image types (`application/pdf`, `text/plain`) with `attachment`.

#### [I4] No orphan R2 cleanup
**Severity:** Important | **File:** N/A (missing)

If a user uploads a file but never sends a message containing the `r2:` marker (e.g., page refresh, network error), the R2 object becomes an orphan with no DB reference and no cleanup path.

**Fix:** Scheduled Worker (cron trigger) that lists R2 objects, cross-references with `attachments` table, and deletes objects with no matching record older than 24h.

#### [I5] WebP magic bytes validation is incomplete
**Severity:** Important | **File:** `src/routes/api/upload/+server.ts`

WebP validation only checks the `RIFF` header (bytes 0-3) but doesn't verify the `WEBP` signature at bytes 8-11. A RIFF-based file (e.g., AVI) could pass as WebP.

**Fix:** Extend WebP check to verify `buf[8]==='W' && buf[9]==='E' && buf[10]==='B' && buf[11]==='P'`.

#### [I6] Full request body buffered before size check
**Severity:** Important | **File:** `src/routes/api/upload/+server.ts`

`request.formData()` buffers the entire body in memory before size validation. A 100 MB upload will be fully buffered before being rejected.

**Fix:** Use streaming body read with a running byte counter, abort at limit. Or rely on Cloudflare Worker's 100 MB request body limit as a coarser guard (sufficient for 10 MB limit).

#### [I7] `img` excluded from DOMPurify ALLOWED_TAGS
**Severity:** Important | **File:** `src/lib/utils/markdown.ts`

The markdown renderer uses DOMPurify with a strict allowlist that excludes `<img>`. Even if MessageBubble parses `r2:` markers into `<img>` tags, they'll be stripped by sanitization.

**Fix:** Add `'img'` to ALLOWED_TAGS with restricted attributes: `['src', 'alt', 'width', 'height', 'loading']`. Ensure `src` is validated to only allow `/api/upload?key=` URLs (not arbitrary external URLs).

#### [I8] `unsafe-inline` in CSP
**Severity:** Important | **File:** `src/hooks.server.ts`

The Content-Security-Policy includes `style-src 'unsafe-inline'` and `script-src 'unsafe-inline'`. While common in SvelteKit apps, this weakens the defense-in-depth against XSS from uploaded content.

**Fix:** Investigate nonce-based CSP for scripts. For images, ensure `img-src` includes `'self'` (which it likely does for `/api/upload` URLs).

#### [I9] ImageModal missing focus trap
**Severity:** Important | **File:** `src/lib/components/chat/ImageModal.svelte`

The lightbox modal doesn't trap focus — pressing Tab moves focus behind the modal to the chat UI. Screen reader users may not realize the modal is open.

**Fix:** Add focus trap: on mount, focus the close button; on Tab at last element, wrap to first; on Shift+Tab at first, wrap to last. Or use a dialog element with `showModal()`.

#### [I10] No Capacitor camera integration
**Severity:** Important | **File:** N/A (missing)

Mobile users on Capacitor can't take photos directly — they'd need to upload from gallery. The design doc mentions camera integration.

**Fix:** Add `@capacitor/camera` plugin for iOS/Android photo capture. Gate behind platform detection.

---

## Fix Plan

Priority order: Critical security → Critical DB → Important security → Important UX → Nice-to-have

| # | ID | Task | Severity | Status |
|---|-----|------|----------|--------|
| 1 | S1 | Add upload rate limiting | Critical | [x] |
| 2 | S2 | Validate `text/plain` content or remove from allowed types | Critical | [x] |
| 3 | S3 | Re-validate Content-Type on GET against allowlist | Critical | [x] |
| 4 | D1 | Make `attachments.message_id` nullable | Critical | [x] |
| 5 | D2 | Add `uploaded_by` column to attachments | Critical | [x] |
| 6 | D3 | Insert `attachments` row on upload | Critical | [x] |
| 7 | I3 | Serve images with `Content-Disposition: inline` | Important | [x] |
| 8 | I5 | Fix WebP magic bytes validation | Important | [x] |
| 9 | I7 | Add `img` to DOMPurify ALLOWED_TAGS | Important | [ ] |
| 10 | I1 | Separate preview/production R2 buckets | Important | [x] |
| 11 | I4 | Orphan R2 cleanup (cron worker) | Important | [ ] |
| 12 | I9 | ImageModal focus trap | Important | [ ] |
| 13 | D4 | `subscriptions` table (Stripe integration) | Deferred | [ ] |
| 14 | I10 | Capacitor camera integration | Deferred | [ ] |
| 15 | I2 | Document ENABLE_UPLOADS GET behavior | Low | [ ] |
| 16 | I6 | Streaming upload with size limit | Low | [ ] |
| 17 | I8 | Investigate nonce-based CSP | Low | [ ] |

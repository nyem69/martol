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

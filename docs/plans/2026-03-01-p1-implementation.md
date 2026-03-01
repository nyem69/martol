# P1 Implementation Plan

All implementable P1 items from docs/003-Auth.md.

## Work Items

### 1. Atomic Agent Creation (standalone, small)

Wrap the 4-step agent creation in `src/routes/api/agents/+server.ts` in a Drizzle `db.transaction()`. If any step fails, all are rolled back — no orphaned users.

**Files:** `src/routes/api/agents/+server.ts`

### 2. Terms Re-Acceptance Middleware (standalone, medium)

Add logic in `src/hooks.server.ts`: after session is resolved, check if the user has accepted the current version of all required terms (tos, privacy, aup). If not, redirect to a re-acceptance page.

**Files:**
- `src/hooks.server.ts` — add terms version check after session resolution
- `src/routes/accept-terms/+page.svelte` — re-acceptance UI (show what changed, checkboxes, submit)
- `src/routes/accept-terms/+page.server.ts` — load current terms versions + user's acceptance state

### 3. CSP Nonce Migration (standalone, medium)

Replace `'unsafe-inline'` in script-src with SvelteKit's `%sveltekit.nonce%` / `event.locals.nonce`. Requires SvelteKit's CSP config in `svelte.config.js` or manual nonce injection in hooks.

**Files:**
- `src/hooks.server.ts` — generate nonce, inject into CSP header
- `src/app.html` — if needed for nonce attribute on script tags

### 4. Settings Page + Username Change (medium)

Create `/settings` route with account management. Start with username personalization since i18n keys and DB schema already exist.

**Files:**
- `src/routes/settings/+page.svelte` — settings UI (username section, sessions section, danger zone)
- `src/routes/settings/+page.server.ts` — load user data, sessions, username history
- `src/routes/api/account/username/+server.ts` — PUT endpoint for username change (validate, check cooldown, record history)
- `src/lib/components/chat/UsernamePrompt.svelte` — inline banner in chat for first-time personalization

### 5. Session Management (depends on settings page)

List active sessions and allow remote logout.

**Files:**
- `src/routes/api/account/sessions/+server.ts` — GET (list) and DELETE (revoke) sessions
- Settings page updated with sessions section

### 6. Data Subject Rights (depends on settings page)

Account data export (JSON download) and account deletion.

**Files:**
- `src/routes/api/account/export/+server.ts` — GET endpoint returns JSON of all user data
- `src/routes/api/account/delete/+server.ts` — POST endpoint for account deletion (soft delete, anonymize messages, clear sessions)
- Settings page updated with danger zone section

## Execution Order

Independent items run in parallel:
- **Track A:** Atomic agent creation (quick)
- **Track B:** Terms re-acceptance middleware
- **Track C:** CSP nonce migration
- **Track D:** Settings page + username + sessions + data rights (sequential within track)

## Verification

- `pnpm check` — 0 errors after each track
- Review agent on completed work

# Features Review — Honest Audit

**Date**: 2026-03-05
**Method**: 5 parallel review agents audited docs accuracy, feature claims, MCP endpoint, badge/open flow, and provided devil's advocate assessment.

---

## Executive Summary

Martol's core architecture is solid — Durable Objects for real-time, server-authoritative risk assessment, HMAC identity binding, and structured intent approval are genuinely good ideas well-executed. However, several documented features are aspirational rather than implemented, the simulation "engine" is weaker than marketed, and the execution gap (approved intent → actual execution) remains the biggest architectural hole.

**Verdict**: Not ready for Show HN. Phase 6 (launch hardening) must complete first, and several critical gaps below need fixing.

---

## 1. Feature Claims Audit

### VERIFIED (10)

| Claim | Status | Evidence |
|---|---|---|
| Real-time chat | VERIFIED | Durable Objects + WebSocket Hibernation API fully implemented |
| Action approval | VERIFIED | Intent submit → approve/reject flow works (gap: no 'executed' status transition) |
| Multi-agent support | VERIFIED | Multiple agent users per org, concurrent WebSocket connections |
| Keys stay yours | VERIFIED | API keys stored per-user, never proxied through Martol servers |
| Team roles | VERIFIED | owner/lead/member/viewer hierarchy enforced server-side |
| Simulation previews | VERIFIED | Diff/shell/API simulation data rendered in approval UI |
| HMAC identity | VERIFIED | SHA-256 HMAC with agent-specific secret, validated on every WS message |
| Org-scoped isolation | VERIFIED | All queries filtered by organization ID |
| Stripe billing | VERIFIED | Free/Pro/Team plans, usage tracking, feature gates |
| Email OTP + passkey | VERIFIED | Better Auth emailOTP plugin + passkey plugin configured |
| Server-enforced intents | VERIFIED | Risk matrix applied server-side, agents cannot bypass |

### PARTIALLY IMPLEMENTED (4)

| Claim             | Gap                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Works everywhere  | No native iOS/Android app published. Capacitor config exists but no App Store presence. Web-only for now.                                                |
| Viewer role       | Role exists in schema but not operationalized — no read-only UI mode, viewers can still send messages via WS                                             |
| 2FA / passkey     | Plugin configured but no setup UI exists for users to add passkeys                                                                                       |
| Append-only audit | Convention only — no DB triggers or constraints preventing UPDATE/DELETE on messages. `deleted_at` soft-delete exists but nothing prevents hard deletes. |

### ~~NOT VERIFIED (1)~~ → VERIFIED

| Claim | Status |
|---|---|
| Open source | FALSE POSITIVE — AGPL-3.0 LICENSE file exists at repo root. Landing page correctly references AGPL-3.0. CLAUDE.md does not mention MIT. |

---

## 2. Documentation Accuracy (vs. Codebase)

### Inaccuracies Found

1. ~~**Simulation field silently stripped**~~ — FALSE POSITIVE. Simulation field IS in the Zod schema (`src/lib/types/mcp.ts:57-70`) and handled correctly in `action-submit.ts`. No `ALLOWED_TOOL_FIELDS` pattern exists — validation is through Zod discriminated unions.

2. **Risk matrix wrong for Member + Low Risk** — FIXED
   - Docs/security page: "Member at low risk → rejected"
   - Reality: Member at low risk → auto-approved (`src/routes/mcp/v1/+server.ts`)
   - Severity: **HIGH** — security docs mislead users about actual behavior

3. **`chat_read` docs claim `before_id?` argument**
   - This argument does not exist in the implementation
   - Only `limit` is accepted
   - Severity: **MEDIUM** — API docs are wrong

4. **`chat_resync` has empty ALLOWED_TOOL_FIELDS**
   - Tool accepts no arguments but ALLOWED_TOOL_FIELDS is an empty set, meaning any supplied arguments are silently stripped
   - Not documented
   - Severity: **LOW**

5. **Path deny-list scope**
   - Docs imply deny-list applies only to Read/Write/Edit tools
   - Reality: deny-list check applies to ALL tools that have path-like arguments
   - Severity: **LOW** — more restrictive than documented (safer, but inaccurate docs)

### Undocumented Features (12)

These exist in the codebase but aren't mentioned in `/docs`:

1. Stripe webhook handling (`/api/stripe/webhook`)
2. Account deletion endpoint (`/api/account/delete`)
3. Invitation accept flow (`/accept-invitation/[id]`)
4. Organization member management API
5. File upload to R2 (referenced in schema, upload endpoint exists)
6. Message edit/delete (soft delete via `deleted_at`)
7. Typing indicators (WS message type exists)
8. Presence/roster (WS message types exist but handlers silently ignore)
9. Agent key rotation (no endpoint — keys are one-time only)
10. Feature gates system (`checkOrgLimits`, plan-based limits)
11. Daily message limits (per-plan, tracked in KV)
12. Multi-language support infrastructure (Paraglide configured, only `en` populated)

---

## 3. MCP Endpoint Audit

### Tools — All 7 Verified

| Tool | Status | Notes |
|---|---|---|
| `intent_submit` | Works | Risk matrix applied correctly |
| `intent_status` | Works | Returns current approval state |
| `chat_send` | Works | Server-derived sender identity |
| `chat_read` | Works | `before_id` argument documented but doesn't exist |
| `chat_resync` | Works | Empty ALLOWED_TOOL_FIELDS (no args accepted) |
| `file_upload` | Works | R2 storage, org-scoped |
| `file_read` | Works | Presigned URL generation |

### Security Issues

1. **Content-length bypass** — Rate limiting checks `content-length` header, not actual body size. Agent can send small header + large body.
2. **Rate limiting is fail-open** — If KV is unavailable, rate limit check passes silently. Should fail-closed.
3. **Rate limit response missing `code` field** — MCP spec expects structured error responses with a `code` field.
4. **HMAC secret exposed to frontend** — Owner/lead users can see agent HMAC secrets in settings UI. Should be write-only after creation.

---

## 4. `/open` Badge Flow Audit

### Issues Found

1. **Duplicate rooms on page reload** — No idempotency guard. Refreshing `/open?repo=owner/name` creates a new room every time. Needs upsert or dedup by repo name per user.
2. **No `checkOrgLimits` call** — `/open` bypasses feature gates entirely. Free-plan users could create unlimited rooms via this endpoint.
3. **`keyResult as any` silent fallback** — If API key creation fails, the page shows an empty string instead of an error. Should surface the failure.
4. **`roomId` returned but never displayed** — Agents need the room ID for WebSocket connections. The page doesn't show it.
5. **Copy button label reuse** — "Copy key" label used for CLI and MCP snippet copy buttons too. Minor UX issue.
6. **No badge documentation** — The SVG badge exists at `/badge/open-in-martol.svg` but there's no documentation on how to add it to a GitHub README.

---

## 5. Devil's Advocate Assessment

### What's genuinely good

- **Durable Objects architecture** — Real isolation, real persistence, real WebSocket hibernation. Not a toy.
- **Server-authoritative risk assessment** — Agents can request any risk level but the server decides. This is the right design.
- **HMAC identity binding** — Every message is cryptographically tied to the sending agent. Can't be spoofed.
- **TOCTOU prevention** — Intent approval checks are atomic within the DO, preventing time-of-check/time-of-use attacks.
- **Structured intent schema** — Forcing agents into `tool_name` + `arguments` + `risk_level` is a meaningful constraint vs. raw chat.

### What's misleading

1. **"Server-side sandboxed execution"** — Agents don't execute on the server. They execute locally and report what they did. The server validates the *intent*, not the *execution*. The phrase "sandboxed" implies containment that doesn't exist.

2. **Simulation "engine"** — There is no simulation engine. The `simulation` field is agent-supplied data (a diff, a shell command, an API call description). Martol renders it but doesn't verify it. An agent could submit a benign simulation and execute something different. The docs should say "simulation preview" not "simulation engine."

3. **Execution gap** — The biggest architectural hole. Flow is: agent submits intent → human approves → then what? There's no server-enforced execution step. The agent is trusted to execute what was approved. A malicious agent could get approval for `cat file.txt` and execute `rm -rf /`. This is the #1 thing competitors will attack.

4. **"Append-only audit log"** — It's a regular PostgreSQL table. Nothing prevents `UPDATE` or `DELETE` at the DB level. The append-only property is a convention enforced by application code, not a guarantee.

### What's missing for launch

- No notifications (email/push) for pending approvals
- No execution confirmation loop (agent reports back what it actually did)
- No agent sandboxing or capability restriction beyond intent approval
- No admin dashboard for org-wide audit review
- No rate limit per-agent (only per-API-key, which is per-agent, but no org-wide throttle)
- Phase 6 (launch hardening) incomplete: no image scanning, no load testing, no Sentry, no accessibility audit

---

## 6. Priority Fixes Before Launch

### P0 — Must fix

| # | Issue | Status |
|---|---|---|
| 1 | ~~Add `simulation` to ALLOWED_TOOL_FIELDS~~ | FALSE POSITIVE — Zod schema includes simulation field, works correctly |
| 2 | Fix risk matrix docs (Member + Low = auto-approved) | FIXED — security page updated to match code |
| 3 | Add idempotency guard to `/open` | FIXED — dedup by repo name per user |
| 4 | Add org count limit to `/open` | FIXED — 20 rooms per user cap |
| 5 | Make rate limiting fail-closed | FIXED — returns 503 when KV unavailable |
| 6 | ~~Add LICENSE file to repo root~~ | FALSE POSITIVE — AGPL-3.0 LICENSE already exists |

### P1 — Should fix

| # | Issue | Why |
|---|---|---|
| 7 | Remove `before_id` from chat_read docs | FIXED — removed nonexistent argument from docs |
| 8 | ~~Change "sandboxed" language to "supervised"~~ | FIXED — security page now says "Server-supervised, scoped per room" |
| 9 | ~~Change "simulation engine" to "simulation preview"~~ | ALREADY DONE — user-facing surfaces use "preview", "engine" only in internal planning docs |
| 10 | Display roomId on `/open` page | FIXED — Room ID shown below repo name |
| 11 | ~~Surface API key creation failures on `/open`~~ | ALREADY DONE — `error(500)` already thrown on failure |
| 12 | Add badge usage docs to `/docs` | FIXED — badge section with markdown/HTML snippets and preview |

### P2 — Nice to have

| # | Issue | Status |
|---|---|---|
| 13 | Add execution confirmation loop | FIXED — `action_confirm` MCP tool: approved → executed transition |
| 14 | Make audit log append-only at DB level | FIXED — DB trigger prevents UPDATE/DELETE on messages (except soft-delete) |
| 15 | ~~Add passkey setup UI~~ | FALSE POSITIVE — passkey UI already exists in settings page |
| 16 | Operationalize viewer role | FIXED — chat input disabled for viewers with read-only message |
| 17 | Document all 12 undocumented features | FIXED — "Platform Features" section added to /docs |

---

## Methodology

Five specialized review agents ran in parallel:

1. **Docs Accuracy Agent** — Compared every claim in `/docs` against actual codebase implementation
2. **Feature Claims Agent** — Verified each marketing claim on the landing page against working code
3. **MCP Endpoint Agent** — Tested all 7 MCP tools, checked rate limiting, error responses, and security
4. **Devil's Advocate Agent** — Challenged assumptions, identified misleading language, assessed launch readiness
5. **Open/Badge Flow Agent** — Tested the `/open?repo=` flow end-to-end, checked for edge cases

Each agent had full codebase access and was instructed to be brutally honest.

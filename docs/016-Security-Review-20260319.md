# 016 — Security Review (Server + Client Integration)

**Review date:** 2026-03-10
**Requested document path:** `docs/016-Security-Review-20260319.md`
**Scope:** `martol` server repo plus neighboring `../martol-client` agent repo
**Method:** Static code review + local validation runs (`pnpm check`, `pnpm test`, `pytest -q`)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| HIGH | 3 |
| MEDIUM | 1 |

**Top risks**
1. Directly approved actions appear to violate the live `pending_actions.approved_by -> user.id` foreign key and likely fail instead of being auto-approved.
2. The WebSocket `id_map` contract has drifted between `martol` and `martol-client`, breaking trigger-message resolution and reply correlation for live agent workflows.
3. `martol-client` leaks the agent API key in the WebSocket URL query string even though the server authenticates from headers.

---

## HIGH

### SR-01: Direct approval path appears broken by invalid `approved_by` foreign key value

**Files**
- `src/lib/server/mcp/tools/action-submit.ts:166-188`
- `src/lib/server/db/schema.ts:211-225`

The direct-approval path in `actionSubmit()` inserts:

```ts
approvedBy: outcome === 'direct' ? 'system' : null
```

But the schema defines `pending_actions.approved_by` as a foreign key to `user.id`.

There is no matching schema or migration evidence for a real user row with id `system`. If that row does not exist in production, any direct approval insert will fail at the database boundary.

**Impact**
- Owner-triggered actions can fail instead of becoming immediately approved.
- Lead low/medium-risk approvals can fail.
- Low-risk member actions that should auto-approve can fail.
- This affects a core server-enforced workflow, not an edge case.

**Recommendation**
- Do not write sentinel strings into FK columns.
- Use `NULL` plus an explicit audit field such as `approved_by_policy = 'system'`, or create a dedicated non-human actor model that satisfies FK integrity.
- Add an integration test that exercises the direct-approval branch against the real schema.

---

### SR-02: `id_map` protocol drift breaks live agent action linkage and reply correlation

**Files**
- `src/lib/server/chat-room.ts:1017-1018`
- `src/lib/types/ws.ts:36`
- `../martol-client/martol_agent/base_wrapper.py:333-343`
- `../martol-client/martol_agent/claude_code_wrapper.py:279-288`
- `src/lib/server/mcp/tools/action-submit.ts:78-107`
- `src/lib/components/chat/ChatInput.svelte:107`
- `../martol-client/martol_agent/base_wrapper.py:403-470`

The server now emits `id_map` as:

```json
{ "type": "id_map", "mappings": [{ "localId": "...", "dbId": 123 }] }
```

But `martol-client` still parses `id_map` as a singleton event with top-level `serverSeqId` and `dbId` fields. That means `_id_map` never fills.

This cascades into two integration failures:

1. `martol-client` falls back to `serverSeqId` for `trigger_message_id`, while the server's `action_submit` path expects a PostgreSQL `messages.id`.
2. Browser replies use `dbId`, but the agent wrapper indexes live WebSocket messages by `serverSeqId`, so "reply to agent" detection can fail for mixed browser/agent conversations.

**Impact**
- `action_submit` can reject valid live-room triggers as `invalid_trigger` or `cursor_behind`.
- Approval/audit chains can attach to the wrong identifier space.
- Agents can miss replies that should trigger a response.

**Recommendation**
- Version and freeze the WS contract between repos.
- Update `martol-client` to consume the array-form `id_map` payload and retain `serverSeqId -> dbId` mappings.
- Add cross-repo integration tests covering:
  - live message -> `id_map` -> `action_submit`
  - browser reply to agent
  - agent reply to browser

---

### SR-03: Agent API key is exposed in WebSocket query strings

**Files**
- `../martol-client/martol_agent/base_wrapper.py:111-113`
- `worker-entry.ts:250-277`

`martol-client` connects to the room with:

```python
url = f"{self.ws_url}?apiKey={self.api_key}"
```

while also sending `x-api-key` in headers. The server authenticates the WebSocket upgrade from the `x-api-key` header path, not from the `apiKey` query parameter.

That makes the query parameter unnecessary secret duplication.

**Impact**
- API keys can end up in reverse-proxy logs, telemetry, exception traces, and browser/network debugging artifacts.
- This increases credential exposure without improving compatibility.

**Recommendation**
- Stop placing API keys in the WebSocket URL.
- Keep authentication in headers only.
- Audit logs and traces for historical leakage if this pattern has been deployed publicly.

---

## MEDIUM

### SR-04: Documented `HMAC_SIGNING_SECRET` fallback does not match runtime behavior

**Files**
- `README.md:131-138`
- `worker-entry.ts:354-356`
- `src/lib/server/chat-room.ts:546-548`
- `src/lib/server/mcp/tools/chat-send.ts:53-59`
- `src/lib/server/mcp/tools/chat-edit.ts:29-35`

The README says the server falls back to `BETTER_AUTH_SECRET` when `HMAC_SIGNING_SECRET` is unset. The runtime paths do not consistently do that:

- WebSocket upgrades hard-fail if `HMAC_SIGNING_SECRET` is missing.
- The DO REST ingest/edit endpoints only accept `X-Internal-Secret === HMAC_SIGNING_SECRET`.
- MCP chat send/edit still try sending `HMAC_SIGNING_SECRET || BETTER_AUTH_SECRET`.

So the documented backward-compatibility path does not match the actual behavior of the real-time system.

**Impact**
- Deployments following the documented fallback can lose WebSocket connectivity or DO-backed MCP messaging.
- Operators can misconfigure production based on misleading documentation.

**Recommendation**
- Choose one behavior and make all call sites consistent.
- If fallback is supported, implement it in WS signing and DO verification paths too.
- If fallback is no longer supported, remove it from the documentation and fail loudly during startup/health checks.

---

## Validation Notes

### `martol`

- `pnpm check`: passed
- `pnpm check` reported 1 warning: unused CSS selector in `src/routes/docs/pricing/+page.svelte`
- `pnpm test`: failed

Observed failures:
- `src/lib/server/mcp/auth.test.ts` appears stale against the current Better Auth response shape (`referenceId` vs older `userId`-style mocks).
- `src/lib/chat/commands.test.ts` expects viewers to only see `/whois`, but the current command registry also exposes `/ticket`.

These test failures did not invalidate the four findings above, but they reduce confidence in regression coverage around auth and command-surface changes.

### `martol-client`

- `pytest -q`: did not pass in the local environment

Observed issues:
- provider tests patch import targets that are not present under `martol_agent.providers`
- async tests are skipped because the local environment is missing the expected async pytest plugin behavior despite `pyproject.toml` declaring `pytest-asyncio`

This limited end-to-end verification, so the review relied primarily on static code-path analysis for the cross-repo protocol findings.

---

## Recommended Next Actions

1. Fix SR-01 first because it can break the core action-approval path for valid traffic.
2. Align the `id_map` protocol across both repos and add a cross-repo integration test for live `action_submit`.
3. Remove query-string API key transport from `martol-client`.
4. Reconcile the documented and actual `HMAC_SIGNING_SECRET` fallback behavior.
5. Repair the stale/broken tests in both repos so future protocol drift is caught automatically.

---

## Remediation Log

| Issue | Fix | Files Changed | Date |
|-------|-----|---------------|------|
| SR-01 | Set `approvedBy: null` instead of `'system'` for direct approvals. NULL + non-null `approved_at` is self-documenting as policy-auto-approved. | `src/lib/server/mcp/tools/action-submit.ts` | 2026-03-10 |
| SR-02 | Added `serverSeqId` to `id_map` mapping entries (server + type). Updated `martol-client` to iterate `mappings` array and key by `serverSeqId`. Updated docs page. | `src/lib/types/ws.ts`, `src/lib/server/chat-room.ts`, `martol-client/martol_agent/base_wrapper.py`, `src/routes/docs/client/+page.svelte` | 2026-03-10 |
| SR-03 | Removed `apiKey` from WebSocket URL query string. Auth remains header-only via `x-api-key`. | `martol-client/martol_agent/base_wrapper.py` | 2026-03-10 |
| SR-04 | Removed dead `\|\| BETTER_AUTH_SECRET` fallback from MCP tools (`chat-send.ts`, `chat-edit.ts`). Fixed stale comment in `chat-room.ts`. Removed false fallback sentence from `README.md`. | `src/lib/server/mcp/tools/chat-send.ts`, `src/lib/server/mcp/tools/chat-edit.ts`, `src/lib/server/chat-room.ts`, `README.md` | 2026-03-10 |

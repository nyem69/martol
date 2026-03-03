# Insider Threat Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 13 security vulnerabilities identified in the insider threat audit (`docs/plans/2026-03-04-insider-threat-audit.md`).

**Architecture:** Split across two repos (martol server + martol-client). Server fixes harden secret management and DO trust boundaries. Client fixes enforce TLS, restrict tool access, and sanitize LLM I/O. Each task is independent — batches can run in parallel.

**Tech Stack:** SvelteKit, Cloudflare Workers/DO, Better Auth, Python asyncio, websockets, Claude Agent SDK

---

## Batch 1: Server Hardening (martol)

### Task 1.1: Add DO membership re-check on WebSocket connect (R5)

The DO trusts the signed identity without verifying the sender is still a member. Add a membership lookup inside the DO.

**Files:**
- Modify: `src/lib/server/chat-room.ts:178` (after HMAC verification)

**Step 1: Add membership re-check after HMAC verification**

After the existing HMAC verification block (line 178), before accepting the WebSocket, query transactional storage or the org membership. Since the DO doesn't have direct DB access, use the `orgId` from the signed identity to verify the connecting user appears in the DO's known members list.

File: `src/lib/server/chat-room.ts` — after the timestamp check (`if (Date.now() - parsedIdentity.timestamp > 60_000)`), add:

```typescript
// Verify orgId matches this DO's room
const storedOrgId = await this.ctx.storage.get<string>('meta:orgId');
if (storedOrgId && storedOrgId !== parsedIdentity.orgId) {
    return new Response('Room mismatch', { status: 403 });
}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "fix(security): verify orgId matches DO room on WebSocket connect (R5)"
```

---

### Task 1.2: Add per-key connection limit in DO (R10)

Prevent the same API key from spawning multiple simultaneous connections.

**Files:**
- Modify: `src/lib/server/chat-room.ts` (WebSocket accept handler)

**Step 1: Track connected user IDs and reject duplicates**

In the WebSocket accept section (after identity verification), before calling `server.accept()`, check if this userId is already connected:

```typescript
// Check if user already has an active connection
for (const ws of this.ctx.getWebSockets()) {
    const tags = this.ctx.getTags(ws);
    const existingUserId = tags.find(t => t.startsWith('uid:'))?.slice(4);
    if (existingUserId === parsedIdentity.userId) {
        // Close the old connection, allow the new one (last-writer-wins)
        ws.close(4002, 'Replaced by new connection');
        break;
    }
}
```

This uses "last-writer-wins" — new connections replace old ones rather than being rejected, which handles legitimate reconnections gracefully.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "fix(security): close old WebSocket on duplicate userId connect (R10)"
```

---

### Task 1.3: Add internal request signing for REST ingest (R13)

The DO REST ingest endpoint (`handleRestIngest`) trusts the caller. Add a shared secret check so only the Worker can call it.

**Files:**
- Modify: `src/routes/api/rooms/[roomId]/ws/+server.ts` (add header to stub.fetch calls)
- Modify: `src/lib/server/mcp/tools/chat-send.ts` (add header to stub.fetch)
- Modify: `src/lib/server/chat-room.ts` (verify header in handleRestIngest)

**Step 1: Add internal auth header to all stub.fetch calls**

In every place that calls `stub.fetch()` for REST ingest, add an `X-Internal-Secret` header using `BETTER_AUTH_SECRET`:

File: `src/lib/server/mcp/tools/chat-send.ts` — in the fetch call:

```typescript
const res = await stub.fetch(ingestUrl, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.BETTER_AUTH_SECRET
    },
    body: JSON.stringify(payload)
});
```

**Step 2: Verify the header in DO handleRestIngest**

File: `src/lib/server/chat-room.ts` — at the top of `handleRestIngest`:

```typescript
// Verify internal caller
const internalSecret = request.headers.get('X-Internal-Secret');
if (!internalSecret || internalSecret !== this.env.BETTER_AUTH_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
}
```

**Step 3: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/lib/server/chat-room.ts src/lib/server/mcp/tools/chat-send.ts
git commit -m "fix(security): add internal auth for DO REST ingest endpoint (R13)"
```

---

## Batch 2: Client TLS & Key Hardening (martol-client)

### Task 2.1: Enforce TLS on WebSocket connections (R4)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:126`
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/claude_code_wrapper.py:107`

**Step 1: Add TLS validation before connect**

In both `wrapper.py` and `claude_code_wrapper.py`, in the `connect()` method, before `websockets.connect()`:

```python
import ssl

# Enforce TLS in production
if not self.ws_url.startswith("wss://") and "localhost" not in self.ws_url and "127.0.0.1" not in self.ws_url:
    raise ValueError(f"Refusing non-TLS WebSocket URL: {self.ws_url}. Use wss:// for production.")

ssl_context = ssl.create_default_context() if self.ws_url.startswith("wss://") else None
```

Then pass `ssl=ssl_context` to the connect call:

```python
async with websockets.connect(url, extra_headers=headers, ssl=ssl_context) as ws:
```

**Step 2: Commit**

```bash
git add martol_agent/wrapper.py martol_agent/claude_code_wrapper.py
git commit -m "fix(security): enforce TLS on WebSocket connections (R4)"
```

---

### Task 2.2: Add --api-key-file flag (R9)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:596-599`

**Step 1: Add argument and file reading logic**

In the argument parser section:

```python
parser.add_argument("--api-key-file", default=os.environ.get("MARTOL_API_KEY_FILE"),
                    help="Path to file containing the Martol API key (more secure than env var)")
```

In the key resolution logic (after parsing args):

```python
# Resolve API key: file > env > CLI arg
api_key = args.api_key
if args.api_key_file:
    with open(args.api_key_file, 'r') as f:
        api_key = f.read().strip()
if not api_key:
    parser.error("--api-key or --api-key-file or MARTOL_API_KEY required")
```

**Step 2: Update .env.example**

Add after `MARTOL_API_KEY=`:

```bash
# Or: path to file containing the API key (more secure)
MARTOL_API_KEY_FILE=
```

**Step 3: Commit**

```bash
git add martol_agent/wrapper.py .env.example
git commit -m "feat(security): add --api-key-file for secure key loading (R9)"
```

---

### Task 2.3: Add .env security warning to README (R2)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/README.md`

**Step 1: Add security section**

Add after the setup section:

```markdown
## Security

API keys grant full control of your agent. Handle them carefully:

- **Never commit `.env` files** — they contain secrets
- **Prefer `--api-key-file`** over environment variables — env vars are visible in `/proc/PID/environ`
- **Use `wss://`** for production — the client rejects non-TLS URLs by default
- **Restrict Claude Code tools** — set `CLAUDE_CODE_ALLOWED_TOOLS=Read,Grep,Glob` to limit filesystem access
- **Rotate keys** if you suspect compromise — revoke in the Martol chat room's member panel
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add API key security guidance to README (R2)"
```

---

## Batch 3: Claude Code Restrictions (martol-client)

### Task 3.1: Enforce tool whitelist in can_use_tool callback (R3)

The `--claude-allowed-tools` flag is advisory. The `can_use_tool` callback should hard-deny tools not in the whitelist.

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/claude_code_wrapper.py:255-286`

**Step 1: Add whitelist enforcement at top of _handle_permission**

```python
async def _handle_permission(
    self,
    tool_name: str,
    input_data: dict,
    context: ToolPermissionContext,
) -> PermissionResultAllow | PermissionResultDeny:
    # Hard-deny tools not in whitelist (if whitelist is configured)
    if self.claude_allowed_tools and tool_name not in self.claude_allowed_tools:
        log.warning("Tool %s blocked by whitelist", tool_name)
        return PermissionResultDeny(message=f"Tool '{tool_name}' not in allowed list")

    # ... existing permission logic continues ...
```

**Step 2: Set safe default when no whitelist configured**

In the `__init__` or argument parsing, if `CLAUDE_CODE_ALLOWED_TOOLS` is empty, set a safe default:

```python
# Default safe tools if no whitelist specified
DEFAULT_SAFE_TOOLS = ["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch"]

if not self.claude_allowed_tools:
    log.info("No tool whitelist set — using safe defaults: %s", DEFAULT_SAFE_TOOLS)
    self.claude_allowed_tools = DEFAULT_SAFE_TOOLS
```

**Step 3: Update .env.example comment**

```bash
# Comma-separated list of allowed tools. Defaults to safe read-only set.
# To allow code edits: Read,Grep,Glob,LS,Edit,Write
# To allow everything (DANGEROUS): leave empty and set CLAUDE_CODE_PERMISSION_MODE=bypassPermissions
CLAUDE_CODE_ALLOWED_TOOLS=
```

**Step 4: Commit**

```bash
git add martol_agent/claude_code_wrapper.py .env.example
git commit -m "fix(security): enforce tool whitelist in Claude Code mode (R3)"
```

---

## Batch 4: LLM I/O Sanitization (martol-client)

### Task 4.1: Validate tool call arguments before MCP (R7)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:430-436`

**Step 1: Add schema validation for known tools**

Before the MCP call loop:

```python
# Known MCP tool schemas — reject unexpected fields
ALLOWED_TOOL_FIELDS = {
    "chat_send": {"body", "reply_to"},
    "chat_read": {"limit", "before_id"},
    "chat_resync": set(),
    "chat_join": set(),
    "chat_who": set(),
    "action_submit": {"action_type", "risk_level", "description", "payload", "trigger_message_id"},
    "action_status": {"action_id"},
}

def _validate_tool_args(name: str, args: dict) -> dict:
    """Strip unexpected fields from tool arguments."""
    allowed = ALLOWED_TOOL_FIELDS.get(name)
    if allowed is None:
        log.warning("Unknown tool %s — passing args through", name)
        return args
    cleaned = {k: v for k, v in args.items() if k in allowed}
    stripped = set(args.keys()) - allowed
    if stripped:
        log.warning("Stripped unexpected fields from %s: %s", name, stripped)
    return cleaned
```

Then in the loop:

```python
for tc in response.tool_calls:
    clean_args = _validate_tool_args(tc.name, tc.arguments)
    log.info("Executing tool: %s(%s)", tc.name, json.dumps(clean_args)[:200])
    result = await self._mcp_call(tc.name, clean_args)
```

**Step 2: Commit**

```bash
git add martol_agent/wrapper.py
git commit -m "fix(security): validate tool arguments before MCP calls (R7)"
```

---

### Task 4.2: Sanitize tool results before feeding to LLM (R8)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:446-449`

**Step 1: Add result sanitization**

```python
MAX_TOOL_RESULT_LENGTH = 8000  # Truncate large results

def _sanitize_tool_result(result: dict | None) -> dict:
    """Truncate and clean tool results before feeding to LLM."""
    if not result:
        return {"ok": False, "error": "No result"}
    # Serialize and truncate
    serialized = json.dumps(result)
    if len(serialized) > MAX_TOOL_RESULT_LENGTH:
        log.warning("Tool result truncated from %d to %d chars", len(serialized), MAX_TOOL_RESULT_LENGTH)
        result = json.loads(serialized[:MAX_TOOL_RESULT_LENGTH - 1] + "}")  # Attempt valid JSON
        # Fallback if truncation breaks JSON
        if not isinstance(result, dict):
            result = {"ok": True, "data": serialized[:MAX_TOOL_RESULT_LENGTH], "truncated": True}
    return result
```

Apply in the tool result building:

```python
for tr in tool_results:
    clean_result = _sanitize_tool_result(tr["result"])
    results.append(
        AnthropicProvider.format_tool_result(tr["tool_call"].id, clean_result)
    )
```

**Step 2: Commit**

```bash
git add martol_agent/wrapper.py
git commit -m "fix(security): truncate and sanitize tool results before LLM (R8)"
```

---

## Batch 5: Client Logging & Rate Limiting (martol-client)

### Task 5.1: Move message body logging to DEBUG (R11)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:231,540`
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/claude_code_wrapper.py:333,515`

**Step 1: Change log.info to log.debug for message content**

In `wrapper.py:231`:
```python
# Before:
log.info("[%s/%s] %s", sender, role, body[:120])
# After:
log.debug("[%s/%s] %s", sender, role, body[:120])
log.info("[%s/%s] message received (%d chars)", sender, role, len(body))
```

In `wrapper.py:540`:
```python
# Before:
log.info("Sent message: %s", body[:80])
# After:
log.debug("Sent message: %s", body[:80])
log.info("Sent message (%d chars)", len(body))
```

Apply same pattern in `claude_code_wrapper.py` at equivalent lines.

**Step 2: Commit**

```bash
git add martol_agent/wrapper.py martol_agent/claude_code_wrapper.py
git commit -m "fix(security): move message content to DEBUG log level (R11)"
```

---

### Task 5.2: Add configurable LLM call rate limit (R12)

**Files:**
- Modify: `/Users/azmi/PROJECTS/LLM/martol-client/martol_agent/wrapper.py:337-354`

**Step 1: Add rate limiter**

Add a simple token bucket:

```python
import time

class RateLimiter:
    """Simple token bucket rate limiter."""

    def __init__(self, max_calls: int, window_seconds: float):
        self.max_calls = max_calls
        self.window = window_seconds
        self.calls: list[float] = []

    def allow(self) -> bool:
        now = time.monotonic()
        self.calls = [t for t in self.calls if now - t < self.window]
        if len(self.calls) >= self.max_calls:
            return False
        self.calls.append(now)
        return True
```

In `__init__`, after setting up conversation:

```python
self.llm_limiter = RateLimiter(max_calls=10, window_seconds=60)  # 10 calls/min default
```

Add CLI arg:

```python
parser.add_argument("--rate-limit", type=int, default=int(os.environ.get("LLM_RATE_LIMIT", "10")),
                    help="Max LLM calls per minute (default: 10)")
```

At the top of `_generate_response`:

```python
if not self.llm_limiter.allow():
    log.warning("LLM rate limit hit — skipping response")
    return
```

**Step 2: Update .env.example**

```bash
# Max LLM API calls per minute (default: 10)
LLM_RATE_LIMIT=10
```

**Step 3: Commit**

```bash
git add martol_agent/wrapper.py .env.example
git commit -m "feat(security): add configurable LLM call rate limit (R12)"
```

---

## Summary: 10 tasks across 5 batches

| Batch | Tasks | Repo | Issues Fixed |
|-------|-------|------|-------------|
| 1: Server Hardening | 3 (R5, R10, R13) | martol | DO trust, dup connections, REST ingest |
| 2: Client TLS & Keys | 3 (R4, R9, R2) | martol-client | TLS enforcement, key file, docs |
| 3: Claude Code Restrictions | 1 (R3) | martol-client | Tool whitelist enforcement |
| 4: LLM I/O Sanitization | 2 (R7, R8) | martol-client | Tool arg validation, result sanitization |
| 5: Logging & Rate Limit | 2 (R11, R12) | martol-client | Debug logging, LLM rate limit |

**R1 (secret splitting) deferred** — requires Better Auth configuration changes and Cloudflare secret rotation. Should be a separate ops task.

**R6 (message integrity HMAC) deferred** — requires coordinated changes in both repos and WebSocket protocol changes. Should be designed separately.

**Batches 1-5 can all run in parallel** since they touch different repos / different files.

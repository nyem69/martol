# Insider Threat Security Audit

**Date:** 2026-03-04
**Scope:** martol (server) + martol-client (agent wrapper)
**Threat model:** Attacker with full read access to both source repositories attempts room takeover and AI agent hijacking.

---

## Executive Summary

Source code alone is **not sufficient** to compromise rooms or agents. The server uses HMAC-signed identities, server-derived sender info, and fresh DB role lookups on every request.

However, source code knowledge **combined with one additional secret** (API key, BETTER_AUTH_SECRET, or database credentials) enables full compromise. The client has weaker boundaries — no TLS enforcement, no message integrity checks, and Claude Code mode allows arbitrary filesystem/command access.

---

## Threat Matrix

| Attack | Code Only | + API Key | + AUTH_SECRET | + DB |
|--------|:---------:|:---------:|:-------------:|:----:|
| Impersonate user in chat | - | - | CRITICAL | CRITICAL |
| Impersonate agent | - | CRITICAL | CRITICAL | CRITICAL |
| Join room uninvited | - | - | CRITICAL | CRITICAL |
| Escalate to owner | - | - | - | CRITICAL |
| Approve risky actions | - | - | CRITICAL | CRITICAL |
| Read message history | - | HIGH | CRITICAL | CRITICAL |
| Execute commands on agent machine | - | CRITICAL | - | - |

---

## Server Findings (martol)

### S1: BETTER_AUTH_SECRET is single point of failure — CRITICAL

**Location:** `.dev.vars` (dev), Cloudflare secret (prod), `hooks.server.ts:74,105`

If compromised, attacker can:
- Forge session tokens for any user
- Forge HMAC signatures for WebSocket identity (bypass membership)
- Forge magic link tokens (bypass OTP)

**Why it matters:** One secret controls sessions, WebSocket auth, and email tokens. No secret separation.

### S2: Durable Object trusts signed identity without re-checking membership — HIGH

**Location:** `chat-room.ts:155-178`, `ws/+server.ts:103-128`

The WebSocket route checks membership (lines 80-84) then signs an identity payload with HMAC. The Durable Object trusts the signature but does not re-verify membership. If an attacker forges the HMAC (requires AUTH_SECRET), they bypass membership entirely.

### S3: REST ingest endpoint trusts caller — HIGH

**Location:** `chat-room.ts:462-588`

The DO's REST endpoint (used by MCP `chat_send`) accepts `senderId`, `senderRole`, `senderName` from the JSON body. It is only reachable via `stub.fetch()` from the Worker. If the DO ever becomes directly routable, full message spoofing is possible.

### S4: Role always fetched from DB — POSITIVE

Roles are never cached in sessions or JWTs. Every request queries the `member` table fresh. Session forgery alone cannot escalate privileges.

### S5: API keys hashed with bcrypt — POSITIVE

Better Auth's apiKey plugin hashes keys before storage. Source code + database read access cannot reverse the hash. An attacker with DB write access can insert new hashes though.

---

## Client Findings (martol-client)

### C1: API key stored plain-text in .env — CRITICAL

**Location:** `.env:2-3`

The MARTOL_API_KEY is stored unencrypted. Also visible via `/proc/PID/environ` on Linux or `ps aux` if passed as CLI arg. Anyone with filesystem or process access gets full agent control.

### C2: No TLS enforcement on WebSocket — HIGH

**Location:** `wrapper.py:126`, `claude_code_wrapper.py:107`

`websockets.connect()` called without SSL context enforcement or certificate pinning. On untrusted networks, MITM can intercept the API key from headers and inject/modify messages.

### C3: No message integrity validation — HIGH

**Location:** `wrapper.py:207-214`

Incoming WebSocket messages are parsed as JSON with no signature verification. A MITM can inject fake messages that the agent treats as legitimate user requests.

### C4: Claude Code mode has full filesystem + Bash access — CRITICAL

**Location:** `claude_code_wrapper.py:199-211`

Claude Code runs with `cwd=os.getcwd()` and access to `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` tools. A chat message like `@agent read .env` can exfiltrate secrets from the agent's machine to the room.

The `--claude-allowed-tools` flag is advisory — the Claude Code SDK has final control over tool execution.

### C5: LLM tool calls passed to MCP without validation — HIGH

**Location:** `wrapper.py:430-436`

Tool call arguments from the LLM are sent directly to the MCP endpoint. A prompt injection attack via chat message could craft malicious action payloads (e.g., spoofed risk levels, SQL injection in description).

### C6: Tool results fed to LLM without sanitization — HIGH

**Location:** `wrapper.py:446-449`

Server responses are fed directly into the LLM context. A compromised server could inject prompt injection payloads in tool results.

### C7: Multiple agent instances can share one API key — MEDIUM

No per-instance binding. An attacker with a leaked key can run parallel agents in the same room, flooding responses or selectively intercepting messages.

### C8: Message bodies logged at INFO level — MEDIUM

**Location:** `wrapper.py:231,540`

Full message content (truncated to 120 chars) logged at INFO level. Log file access leaks chat content.

### C9: No rate limiting on LLM calls — MEDIUM

**Location:** `wrapper.py:337-354`

Every @mention triggers an LLM call. An attacker can spam mentions to run up API costs or exhaust rate limits.

---

## Prioritized Remediation Plan

### P0 — Critical (do first)

| ID | Issue | Fix | Repo |
|----|-------|-----|------|
| R1 | AUTH_SECRET single point of failure | Split into separate secrets: SESSION_SECRET, HMAC_SECRET, MAGIC_LINK_SECRET | martol |
| R2 | API key plain-text in .env | Document secure alternatives (OS keychain, secrets manager). Add `.env` security warning to README | martol-client |
| R3 | Claude Code unrestricted filesystem | Default `--claude-allowed-tools` to safe subset (Read,Grep,Glob). Enforce whitelist in `can_use_tool` callback | martol-client |
| R4 | No TLS enforcement | Enforce `wss://` scheme. Add `ssl=` context to `websockets.connect()`. Reject non-TLS URLs | martol-client |

### P1 — High (next sprint)

| ID | Issue | Fix | Repo |
|----|-------|-----|------|
| R5 | DO trusts signed identity without re-check | Add orgId membership lookup inside DO on WebSocket connect | martol |
| R6 | No message integrity on client | Add HMAC signature to server→client WebSocket messages. Verify in client before processing | martol + martol-client |
| R7 | Tool calls unsanitized | Validate tool arguments against schema before MCP call. Reject unexpected fields | martol-client |
| R8 | Tool results unsanitized | Strip/escape tool results before feeding to LLM. Detect prompt injection patterns | martol-client |
| R9 | API key visible in process env | Use `--api-key-file` flag to read from file instead of env/CLI arg | martol-client |

### P2 — Medium (backlog)

| ID | Issue | Fix | Repo |
|----|-------|-----|------|
| R10 | Multiple instances per key | Add per-key connection limit in DO (reject if key already connected) | martol |
| R11 | Message body logging | Move message content logging to DEBUG level | martol-client |
| R12 | No LLM call rate limit | Add configurable rate limit (e.g., 10 calls/min default) | martol-client |
| R13 | REST ingest trusts caller | Add internal request signing (Worker-to-DO shared secret) | martol |

---

## Architecture Notes

### What the server does right
- Sender identity is **always server-derived** (from session/API key, never client payload)
- Roles fetched from DB on every request (not cached)
- HMAC-SHA256 signed WebSocket identity with 60s expiry
- Membership verified before connection handshake
- API keys hashed with bcrypt (irreversible)

### What the client should improve
- Treat network as untrusted (TLS enforcement, message signing)
- Treat LLM output as untrusted (validate tool calls, sanitize results)
- Treat filesystem as sensitive (restrict Claude Code tool access)
- Treat secrets as high-value (keychain, file-based, never CLI args)

### The fundamental trust boundary

```
                    TRUSTED                          UNTRUSTED
                    ┌──────────┐                     ┌──────────────┐
                    │  Server  │◄── HMAC-signed ────►│   Network    │
                    │  (DO)    │    identity          │              │
                    └──────────┘                     └──────┬───────┘
                         │                                  │
                    DB-verified                        No integrity
                    membership                         validation
                         │                                  │
                    ┌──────────┐                     ┌──────────────┐
                    │  Postgres│                     │ martol-client│
                    │  (roles) │                     │  (agent)     │
                    └──────────┘                     └──────────────┘
```

The server correctly distrusts the client. The client incorrectly trusts the server and the network.

# Brief System Proposal — Multi-Expert Review

**Document reviewed:** `docs/013-Brief-System.md`
**Review date:** 2026-03-08
**Review method:** 7 parallel expert agents analyzing from distinct perspectives

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Security Review](#1-security-review)
3. [UI/UX Review](#2-uiux-review)
4. [Software Architecture Review](#3-software-architecture-review)
5. [Database Review](#4-database-review)
6. [Cloudflare Platform Review](#5-cloudflare-platform-review)
7. [LLM/AI Integration Review](#6-llmai-integration-review)
8. [Devil's Advocate Review](#7-devils-advocate-review)
9. [Cross-Cutting Consensus](#cross-cutting-consensus)
10. [Recommended Action Plan](#recommended-action-plan)

---

## Executive Summary

Seven expert perspectives reviewed the brief system proposal. The core concept — versioned project briefs injected into agent context to prevent instruction drift — is **unanimously validated as solving a real problem**. However, all seven reviewers independently flagged that the proposed scope is disproportionate to the immediate need. The consensus recommendation is to **ship a minimal 2-table system first** (`project_brief` + `active_brief_pointer`) with manual management and a single MCP tool (`brief_get_active`), then extend incrementally as real usage patterns emerge.

### Critical Blockers (must fix before any implementation)

| # | Issue | Source |
|---|---|---|
| 1 | **`orgId` type mismatch** — proposal uses `bigint`, existing schema uses `text` | Database, Architecture |
| 2 | **Missing CHECK constraints** — Drizzle `enum` hints don't generate DB constraints | Database |
| 3 | **No role check on approve/reject endpoints** | Security |
| 4 | **Prompt injection via extraction pipeline** — chat messages can manipulate brief state | Security, LLM/AI |
| 5 | **Feedback loops** — extraction can re-extract its own system events | LLM/AI |
| 6 | **Concurrent promotion race condition** — no `SELECT FOR UPDATE` or advisory lock | Database, Architecture |
| 7 | **NULL `room_id` breaks UNIQUE constraint** — PostgreSQL treats NULL ≠ NULL | Database |

### Top Strategic Finding

The devil's advocate review makes the strongest case: a single `room_brief TEXT` column with deterministic injection at agent task start solves the stated problem ("agent forgot instructions after 50 messages") for ~5% of the proposed engineering effort. The full versioned patch system with extraction pipeline solves a hypothetical v2 problem that Martol does not yet have at scale. **Ship the simple solution now; build the sophisticated system when users demonstrate they need it.**

---

## 1. Security Review

### Critical Issues (4)

**S1. No role check on approve/reject endpoints** — The proposal defines `POST /api/briefs/patches/:id/approve` but specifies no server-side role enforcement. Any authenticated member could approve high-impact patches. Must enforce a role matrix per `patchType` (owner/lead for goal_change, architecture_change, phase_change; member for clarification/deferment only if non-conflicting).

**S2. Prompt injection via extraction pipeline** — The extraction pipeline reads chat messages and feeds them to an LLM classifier. A participant can craft messages designed to produce specific brief patches. Combined with auto-accept at confidence ≥ 0.90, this creates a full prompt injection → brief mutation attack chain. Agent-sourced patches must never be auto-accepted.

**S3. JSON Pointer path traversal in `diff.ops`** — The `diff.ops[].path` field uses JSON Pointer paths. Without an explicit allowlist of valid path prefixes (`/goal/`, `/currentScope/`, etc.), an attacker can supply paths like `/../../org_id` or `/status` to overwrite metadata fields when the patch is applied.

**S4. Extraction LLM controls auto-accept (closed loop)** — The LLM classifier determines `patchType`, `confidence`, and `conflictsWithActive`. These values then drive auto-accept policy. The LLM's classification is both the evidence and the judge — `conflictsWithActive` must be recomputed server-side by deterministic diff against the active brief, not trusted from LLM output.

### High Issues (8)

- Agent flood: no rate limit on `brief_propose_patch` — cap at 20 outstanding proposals per agent per room
- Cross-org data exposure: `briefKey` is predictable, queries must always include `org_id` from server session
- Agent-forged `sourceRefs`: agents can claim any message ID as a source for a patch — server must verify message existence and room membership
- Unbounded text fields: `excerpt`, `rationale`, `title` have no length caps — enforce via Zod (title 200, rationale 2000, excerpt 1000 chars)
- `POST /api/briefs/refresh` is an unbounded LLM trigger — restrict to owner/lead, rate limit 1 per 5 min
- `GET /api/briefs/history` has no pagination — default limit=20, max=100
- Agents can access briefs from rooms they've left — verify room membership on all brief read endpoints
- `brief_source_ref` missing `room_id` scope — add to table and index

### Medium Issues (5)

- Auto-accept has no auditable policy record — add `accepted_by_policy TEXT` column
- `task_id TEXT` has no FK — validate format at API layer
- `briefKey` has no pattern enforcement — validate `/^[a-z0-9-]{1,64}$/`
- `is_latest` boolean diverges under concurrent binds — use partial unique index
- Full brief injected to low-trust agents — define field-level access by trust level

---

## 2. UI/UX Review

### Must-Fix Issues (13)

**U1. Drawer conflicts with existing MemberPanel** — Both are right-side panels toggled from the header. Must decide: mutually exclusive toggle or tabbed container. Cannot have two independent right-side drawers.

**U2. Drawer must be full-screen overlay on mobile** — A 35-40% width drawer leaves the timeline at 230px on a 390px phone. Use full-screen bottom sheet on viewports < `md`.

**U3. Touch targets below 44px minimum** — `[View diff] [Approve] [Reject]` buttons on a 320px card will render at ~28-32px height. Use `min-h-[44px]` from day one.

**U4. Empty states for all three drawer sections** — No active brief: "No active brief. [Create first brief]". No patches: "No pending updates". No decisions: "No decisions recorded yet."

**U5. Error state when brief fetch fails** — Show "Could not load brief. [Retry]" not blank sections.

**U6. Loading skeleton for BriefDrawer** — Fetch round-trip before content renders needs a skeleton loader.

**U7. `actionsInFlight` guard on approve/reject** — Must prevent double-submit, same lesson as action approval UI.

**U8. REST approve/reject must broadcast room event via DO** — The proposal warns about this but doesn't specify the mechanism.

**U9. BriefDrawer focus trap on mobile** — Full-screen overlay must trap focus with `<dialog>` or `inert`.

**U10. Diff lines need aria-labels for screen readers** — `+`/`-` prefixes read as literal symbols. Use `aria-label="Added: ..."`.

**U11. Approve/reject buttons need `aria-describedby`** — Two patch cards both have `[Approve]` with no distinction for screen readers.

**U12. Drawer should open collapsed by default** — Show brief title + version badge + "(3 proposed updates)" count. Don't expand all three sections.

**U13. Header has no room for four icon buttons on mobile** — Move Brief access into hamburger menu or user menu dropdown.

### Should-Fix Issues (11)

- "Brief" label is opaque to new users — add tooltip on first encounter
- Inline brief events should be visually lighter than action cards
- BriefSystemLine "Review" CTA needs clearer inline text
- "View diff" should expand inline, not open modal inside drawer (z-index/focus issues)
- "Propose update" needs a scoped form specification
- BriefPatchCard should share visual grammar with PendingActionLine
- Conflict badge must use `var(--danger)` color
- Optimistic update revert must be wired in new components
- Stale binding warning must use WS push, not poll
- Confidence score must not rely on color alone (accessibility)
- Diff preview scroll trap on mobile with many ops

---

## 3. Software Architecture Review

### Critical Issues (1)

**A1. `orgId bigint` vs `text` type mismatch** — Better Auth generates text-format organization IDs (nanoids). Using `bigint` for `orgId` in brief tables means no valid FK relationship and all existing `orgId` values would fail to insert. **Must be corrected to `text('org_id')` before generating any migration.**

### High Issues (8)

- **Brief promotion not atomic** under concurrent accepts — add `SELECT FOR UPDATE` or advisory locks
- **No test strategy** for extraction pipeline — need labeled test set of 50+ conversation snippets
- **No integration test** for promotion transaction (concurrent, partial-failure, rollback)
- **No partial index** for active brief hot path — `WHERE status = 'active'` partial unique index enforces single-active invariant at DB level
- **Brief promotion failure** can orphan `active_brief_pointer` — all three writes must be in same transaction
- **Extraction pipeline** has no DO hook or trigger point defined
- **Undefined extraction failure** behavior — errors should log, create `proposed` patch with `confidence = null`, and emit system event
- **6 tables shipped when 2 suffice** for Phase A — schema debt for behavior with no exercising code
- **JSONB schema-within-schema** — Drizzle `$type<>()` hints erased at runtime, no shape validation on read — add versioned Zod schema per JSONB column

### Recommended Ship Order

```
Phase A (1 week): Minimum viable brief
  A1. Schema: project_brief + active_brief_pointer
  A2. API: POST /api/briefs (create), GET /api/briefs/active
  A3. MCP tool: brief_get_active
  A4. Agent injection: every agent task includes active brief
  → Agents stop forgetting project brief immediately

Phase B (1-2 weeks): Human-managed decisions
  B1. Table: brief_decision
  B2. Remaining JSONB columns on project_brief
  B3. API: POST /api/briefs/promote (atomic tx)
  B4. MCP tool: brief_get_recent_decisions
  B5. Timeline system event for brief promotion

Phase C (2-4 weeks): Agent-proposed patches
  C1. Tables: brief_patch, brief_source_ref
  C2. Approval API and UI
  C3. MCP tools: brief_propose_patch, brief_diff

Phase D (4+ weeks): Automated extraction
  D1. Table: task_brief_binding
  D2. Extraction pipeline
  D3. Conflict detection, auto-accept policy
```

---

## 4. Database Review

### Critical Issues (4)

**D1. `org_id` type mismatch** (`bigint` vs `text`) — breaks FK graph and joins with all existing tables.

**D2. Missing CHECK constraints** — Drizzle `text('col', { enum })` does NOT generate DB-level constraints. All status/type columns need explicit `check()` calls matching existing schema pattern.

**D3. UNIQUE constraint with nullable `room_id`** — PostgreSQL treats `NULL ≠ NULL`, so multiple org-wide briefs with same `(org_id, NULL, brief_key, version)` can be inserted. Need conditional unique indexes.

**D4. Race condition in promotion** — concurrent promotions can produce duplicate active briefs. Need optimistic lock (`WHERE version = :expected`) or `FOR UPDATE`.

### High Issues (3)

- `active_brief_pointer` desync risk — no enforcement that pointer tracks `status = 'active'` row
- `brief_source_ref` allows all three FK columns NULL simultaneously — needs CHECK constraint
- Missing version-guard in promotion UPDATE

### Missing Indexes

| Table | Missing Index | Purpose |
|---|---|---|
| `brief_patch` | `(base_brief_id, status)` | "Show proposed patches for active brief" |
| `brief_source_ref` | `(patch_id)`, `(decision_id)`, `(brief_id)` | Forward lookups for source display |
| `task_brief_binding` | `(brief_id)` | "All tasks bound to brief version X" |
| `brief_decision` | `(supersedes_decision_id)` | Chain traversal |

### Storage Growth Projections

| Table | Growth Rate (1000 orgs) | Size/Year |
|---|---|---|
| `project_brief` | 260K rows | ~1.3 GB |
| `brief_patch` | 3.65M rows | ~18 GB ⚠️ |
| `brief_decision` | 104K rows | trivial |
| `brief_source_ref` | tracks patch growth | ~3.6 GB |

**`brief_patch` is the largest growth risk** — needs retention policy (archive terminal-state patches > 90 days).

### Naming Convention Inconsistencies

- `org_id`: existing = `text`, proposed = `bigint` ❌
- FK `.onDelete()`: existing = always explicit, proposed = missing throughout ❌
- CHECK constraints: existing = explicit `check()`, proposed = missing from Drizzle ❌
- Actor columns: existing = FK to `user.id`, proposed = no FK ❌

---

## 5. Cloudflare Platform Review

### High Issues (2)

**C1. Extraction pipeline cannot run synchronously in Worker or DO** — DO `webSocketMessage` handler must return quickly (single-threaded). Workers AI calls take 200ms–2000ms. The extraction pipeline must be decoupled from the message ingestion path entirely.

**Recommended approach for MVP:** Use the existing hourly cron trigger in `wrangler.toml`. The cron Worker reads recent messages from PostgreSQL, runs extraction against `env.AI`, creates `brief_patch` rows. Fully outside the hot path with a 15-minute CPU budget.

**C2. No mechanism to push brief events from REST to DO WebSockets** — When a patch is approved via REST, connected clients need to learn about it. Requires a new `/brief-event` internal endpoint on the DO, called by the REST handler after the DB transaction commits.

### Medium Issues (4)

- **DO storage should NOT hold brief data** — briefs belong in PostgreSQL + KV cache only. DO holds only `meta:activeBriefVersion` for broadcast.
- **Brief reads add Hyperdrive connection pressure** — use `active_brief_pointer` index; avoid DB reads in DO message handler
- **Hibernation race** — newly connected clients miss brief updates. Add `brief_sync` event on WebSocket connect.
- **Alarm collision** — DO has single alarm slot reserved for WAL flush. All brief processing must stay outside the DO.

### KV Caching Recommendation

```
Key:   brief:active:{orgId}:{roomId}:{briefKey}
TTL:   300 seconds (5 minutes)
Write: Invalidate on promotion
Read:  KV first → DB on miss → write to KV
```

Active brief is ideal for KV caching: high-read, low-write, eventually-consistent reads are acceptable.

### Cost Analysis

- DO requests for brief events: negligible ($0.15/million, promotions are rare)
- KV reads: well under $1/month for 100 rooms
- Hyperdrive queries: well within free tier
- **Workers AI extraction is the main cost driver** — ~$5.50/day at 1000 messages/day. Track `last_extracted_at` to avoid reprocessing.

---

## 6. LLM/AI Integration Review

### High Issues (2)

**L1. Prompt injection via chat messages** — The extraction pipeline is directly exposed to adversarial input from any room participant. A user can craft messages designed to produce specific brief patches. Server-enforced `sender_role` gating is required: `member` role messages must never generate `goal_change`, `phase_change`, or `architecture_change` patches at any confidence level.

**L2. Feedback loops** — Two unguarded loops identified:

*Loop 1: Extraction → Brief Update → System Event → Re-extraction.* System events contain scope-like language and re-enter the extraction pipeline. **Fix:** Exclude `type: 'system'` messages from directive detection.

*Loop 2: Agent Brief Injection → Agent Response → Extraction → Brief Change.* Agent paraphrases of brief constraints are classified as new directives. **Fix:** Agent messages (`is_agent: true`) should never generate patches above `confidence: 0.60` and never auto-accept.

**Rate-limit circuit breaker:** >3 patches per `brief_key` per 5 minutes should pause extraction and alert a human.

### Medium Issues (4)

- **Confidence thresholds are arbitrary** — LLM-generated confidence is not a calibrated probability. Treat as ordinal rank (high/medium/low), not cardinal. Auto-accept must be gated by patch type, not just confidence.
- **Context window token budget** — Brief injection adds 1,000–4,500 tokens per agent call. Define a hard budget (1,200 tokens max for MVP). Agents get a compressed brief summary, not full JSONB.
- **Multi-agent patch conflicts** — Two agents can propose overlapping patches. Add `proposed_by_agent_id` deduplication and patch-to-patch conflict detection.
- **False positive/negative rates** — 15–30% false positive rate expected for boundary cases. The human review gate catches these in MVP but creates reviewer fatigue if extraction is too sensitive.

### Blocking Changes Before Extraction Goes Live

1. Server-enforced sender role gate on patch proposal (member → never goal/phase/architecture change)
2. Patch-type allowlist for auto-accept (clarification and deferment only)
3. Source message filter (exclude system events and agent messages from extraction)
4. Rate-limit circuit breaker (>3 patches/5min pauses extraction)

### MCP Tool Assessment

| Tool | Assessment |
|---|---|
| `brief_get_active` | ✅ Good — ship first |
| `brief_get_recent_decisions` | ✅ Good — ship in Phase B |
| `brief_propose_patch` | ✅ Good — appropriate write boundary |
| `brief_bind_to_task` | ❌ Remove from agent-callable tools — make server-side automatic |
| `brief_diff_active_vs_patch` | ✅ Good — useful for agent reasoning |

**Missing:** `brief_list_keys` (discover which brief keys exist in a room).

---

## 7. Devil's Advocate Review

### Core Challenge: Is This the Right Scope?

The stated problem ("agent forgot instructions after 50 messages") has four solutions of increasing complexity:

| Solution | Effort | Solves the problem? |
|---|---|---|
| A. Room brief text field | 1 migration, 1 form | 80% ✅ |
| B. Pinned message | 1 feature, 0 tables | Partially |
| C. `project_brief` table only | 1 table, 1 MCP tool | 90% ✅ |
| D. Full 5-table system with extraction | 4-6 weeks | 100% ✅ |

**The proposal jumped from problem statement to option D without evaluating B or C.** A single `room_brief TEXT` column with deterministic injection at agent task start would solve the immediate failure mode.

### Hidden Assumptions

1. **Conversations are long-running enough to need drift detection** — early Martol users may not reach this scale
2. **The task system exists** — `task_brief_binding` references a task DAG that hasn't been built
3. **Users know what goes in a brief** — 9 JSONB fields assume structured user behavior; most users will fill `goal` and leave everything else empty
4. **Confidence scores are computable** — the schema stores `NUMERIC(4,3)` but no system produces this number yet
5. **Brief management is a human-facing feature** — the stated problem is agent-facing; the elaborate UI serves review, but `GET /api/briefs/active` is what actually solves it
6. **The document is a vetted proposal** — first 170 lines are raw chat transcripts from a brainstorming session

### Timing Problem

From `docs/010-Features-Review.md`, the core agentic loop (intent → approval → execution → result) is not complete. Building brief management before closing the execution gap is "building the dashboard before the engine."

### What Can Be Cut

**Cut entirely** (no core value lost at this stage):
- `brief_source_ref` — auditing infrastructure, not functional
- `task_brief_binding` — nothing to bind to
- `active_brief_pointer` — premature optimization
- The entire automatic extraction pipeline

**What remains after cuts** (solves 90% of the stated problem):
- `project_brief` table (versioned snapshots)
- Manual "promote new version" endpoint
- `brief_get_active` MCP tool
- Brief display in room sidebar

That is ~20% of the proposed scope.

---

## Cross-Cutting Consensus

Issues flagged independently by 3+ reviewers:

| Issue | Flagged by | Consensus |
|---|---|---|
| `orgId bigint` vs `text` type mismatch | Database, Architecture, Security | **Must fix — blocker** |
| Over-scoped for current stage | Devil's Advocate, Architecture, Cloudflare | **Ship minimal first** |
| Extraction pipeline is speculative/risky | LLM/AI, Security, Devil's Advocate, Cloudflare | **Defer to Phase D** |
| Concurrent promotion race condition | Database, Architecture, Security | **Add FOR UPDATE** |
| Missing CHECK constraints in Drizzle | Database, Architecture | **Match existing schema pattern** |
| Auto-accept policy too aggressive | Security, LLM/AI | **Gate by patch type, not just confidence** |
| REST→DO notification gap | UI/UX, Cloudflare | **Add /brief-event endpoint** |
| Mobile UI underspecified | UI/UX | **Full-screen overlay on mobile** |
| Feedback loops in extraction | LLM/AI, Security | **Filter system events and agent messages** |

---

## Recommended Action Plan

### Phase 0: This Week (0 effort)
- Add `room_brief TEXT` column to existing schema as an interim solution
- Inject at agent context build time in `wrapper.py`
- Users can edit via a simple textarea in room settings
- **This immediately solves "agent forgot instructions"**

### Phase A: Weeks 1-2 (Minimum Viable Brief)
1. Fix `orgId` to `text` in all proposed tables
2. Add CHECK constraints matching existing schema pattern
3. Ship only `project_brief` + `active_brief_pointer` (2 tables)
4. Ship `GET /api/briefs/active` + `POST /api/briefs` endpoints
5. Ship `brief_get_active` MCP tool
6. Wire agent injection in `wrapper.py` system prompt
7. Add partial unique index `WHERE status = 'active'`

### Phase B: Weeks 3-4 (Human-Managed Decisions)
1. Add `brief_decision` table
2. Add `POST /api/briefs/promote` with atomic transaction + `FOR UPDATE`
3. Add DO `/brief-event` internal endpoint for WebSocket broadcast
4. Add `brief_sync` event on WebSocket connect
5. Add KV caching for active brief (5-min TTL)
6. Add brief display in sidebar (collapsed by default)

### Phase C: Weeks 5-8 (Agent-Proposed Patches)
1. Add `brief_patch` + `brief_source_ref` tables
2. Add role-gated approve/reject endpoints
3. Add patch-type allowlist for auto-accept (clarification/deferment only)
4. Add inline `BriefSystemLine` in chat timeline
5. Add diff preview (inline expand, not modal-in-drawer)

### Phase D: After Validation (Automated Extraction)
- Only after Phase C is validated by real users
- Cron-based batch extraction (not synchronous)
- Heuristic pre-filter before LLM classification
- Server-enforced sender role gating
- System event and agent message filtering
- Rate-limit circuit breaker
- `task_brief_binding` (only after task DAG exists)

---

## Implementation Status

**Updated:** 2026-03-10

### Phase 0: Completed

Brief stored in `organization.metadata` JSON (no migration needed).

| Task | Status | Files |
|------|--------|-------|
| Add `brief` to `chat_who` MCP response | Done | `src/lib/server/mcp/tools/chat-who.ts`, `src/lib/types/mcp.ts` |
| GET/PUT `/api/rooms/[roomId]/brief` endpoint | Done | `src/routes/api/rooms/[roomId]/brief/+server.ts` |
| Brief section in MemberPanel (textarea, save, read-only for non-leads) | Done | `src/lib/components/chat/MemberPanel.svelte` |
| i18n keys | Done | `messages/en.json` |
| Inject brief into agent system prompt | Done | `martol-client/martol_agent/base_wrapper.py`, `martol-client/martol_agent/wrapper.py` |

### Phase A: Completed (partial)

| Task | Status | Files |
|------|--------|-------|
| `brief_get_active` MCP tool + schema + router | Done | `src/lib/server/mcp/tools/brief-get.ts`, `src/lib/types/mcp.ts`, `src/routes/mcp/v1/+server.ts` |
| `brief_get_active` tool definition in martol-client | Done | `martol-client/martol_agent/tools.py` |
| Versioned brief table (`project_brief` with partial unique index) | Done | `src/lib/server/db/schema.ts`, `drizzle/0019_curved_james_howlett.sql` |
| GET/PUT endpoint uses `project_brief` table + metadata fallback | Done | `src/routes/api/rooms/[roomId]/brief/+server.ts` |
| `brief_get_active` reads from `project_brief` + fallback | Done | `src/lib/server/mcp/tools/brief-get.ts` |
| `chat_who` reads brief from `project_brief` + fallback | Done | `src/lib/server/mcp/tools/chat-who.ts` |
| `BriefGetResult` includes `version` field | Done | `src/lib/types/mcp.ts` |

### Phase B–D: Not started

---

*Generated by 7 parallel expert review agents on 2026-03-08.*
*Perspectives: Security, UI/UX, Software Architecture, Database, Cloudflare Platform, LLM/AI Integration, Devil's Advocate.*

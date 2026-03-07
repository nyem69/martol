# Action Preview System

**Date:** 2026-03-04
**Status:** Implemented (Phase 2 of pre-launch feature plan)
**Revised:** 2026-03-05 (post-review hardening)

---

## What It Does

The action preview system lets agents submit structured descriptions of their intended changes alongside action intents. Instead of seeing "Agent wants to modify auth.ts", humans see the declared diff, the impact assessment, and risk factors — then approve, edit, or reject with full context.

This is additive. Agents that don't send preview data still work exactly as before — the approval card shows the text description only.

---

## Trust Model

**Previews are agent-declared, not server-verified.** The server stores what the agent claims it will do. Nothing enforces that the agent's actual behavior after approval matches its declared preview — the server has no access to the agent's execution environment, no sandbox, and no hook into post-approval execution.

This means:

- A preview showing a one-line diff in `src/auth.ts` does not guarantee the agent will only modify that file
- Risk factors like "pre-approved by security team" are agent-fabricated text, not system analysis
- The audit log records the declared preview, not the actual changes

**What IS server-enforced:**
- Risk level (derived from `ACTION_RISK_MAP`, never from agent claims)
- Role × risk approval matrix (who can approve what)
- Agent self-approval gate (agents cannot approve their own actions)
- Payload size limits (max 50KB serialized)

**What is NOT server-enforced:**
- Whether the preview matches actual post-approval behavior
- Whether risk factors are truthful
- Whether impact assessments are accurate

The preview system improves approval decisions by giving humans structured context, but it is a declaration system, not a verification system.

---

## Architecture

```
Agent submits action_submit with simulation object
    ↓
Server validates total simulation size (max 50KB)
    ↓
Server derives risk from ACTION_RISK_MAP (never trusts agent)
    ↓
Server augments risk if simulation.impact.reversible === false
    ↓
Server stores simulation_type, simulation_payload, risk_factors, estimated_impact
    ↓
GET /api/actions returns simulation fields to client
    ↓
PendingActionLine renders type-specific preview (diff, shell, API call, file ops, custom)
```

No new routes. No new components. No new API endpoints. The preview system extends the existing action approval pipeline end-to-end.

---

## Database Schema

Four nullable columns added to `pending_actions`:

```sql
ALTER TABLE pending_actions ADD COLUMN simulation_type text;
ALTER TABLE pending_actions ADD COLUMN simulation_payload jsonb;
ALTER TABLE pending_actions ADD COLUMN risk_factors jsonb;
ALTER TABLE pending_actions ADD COLUMN estimated_impact jsonb;
```

Migration: `drizzle/0006_dashing_black_widow.sql`

### Column Details

| Column | Type | Description |
|--------|------|-------------|
| `simulation_type` | `TEXT` | `'code_diff'` \| `'shell_preview'` \| `'api_call'` \| `'file_ops'` \| `'custom'` \| `NULL` |
| `simulation_payload` | `JSONB` | Type-specific preview data (shape depends on `simulation_type`) |
| `risk_factors` | `JSONB` | Array of `{ factor, severity, detail }` — **agent-supplied** risk explanations (unverified) |
| `estimated_impact` | `JSONB` | `{ files_modified?, services_affected?, reversible? }` — **agent-declared** (unverified) |

All nullable. Existing actions (without preview data) have `NULL` in all four columns.

---

## MCP Tool: `action_submit`

### Schema (Zod)

The `simulation` field is optional on the existing `action_submit` params:

```typescript
simulation: z.object({
    type: z.enum(['code_diff', 'shell_preview', 'api_call', 'file_ops', 'custom']),
    preview: z.record(z.string(), z.unknown()),  // type-specific shape
    impact: z.object({
        files_modified: z.number().int().nonnegative().optional(),
        services_affected: z.array(z.string()).max(20).optional(),
        reversible: z.boolean().optional(),
    }).optional(),
    risk_factors: z.array(z.object({
        factor: z.string().max(100),
        severity: z.enum(['low', 'medium', 'high']),
        detail: z.string().max(500),
    })).max(10).optional(),
}).optional()
```

### Size Validation

The server validates the total serialized size of the `simulation` object (not just `preview`). Max 50KB. This is below the MCP transport guard of 64KB at `src/routes/mcp/v1/+server.ts`.

### Example: Code Diff

```json
{
    "tool": "action_submit",
    "params": {
        "action_type": "code_modify",
        "risk_level": "medium",
        "trigger_message_id": 42,
        "description": "Add JWT validation to login endpoint",
        "simulation": {
            "type": "code_diff",
            "preview": {
                "file": "src/auth.ts",
                "diff": "- const token = getToken(req);\n+ const token = getToken(req);\n+ if (!verifyJwt(token)) throw new AuthError();\n+ const claims = decodeJwt(token);",
                "lines_added": 3,
                "lines_removed": 1
            },
            "impact": {
                "files_modified": 1,
                "services_affected": ["auth"],
                "reversible": true
            },
            "risk_factors": [
                {
                    "factor": "modifies_auth",
                    "severity": "medium",
                    "detail": "Changes authentication logic"
                }
            ]
        }
    }
}
```

### Example: Shell Command

```json
{
    "tool": "action_submit",
    "params": {
        "action_type": "deploy",
        "risk_level": "high",
        "trigger_message_id": 42,
        "description": "Deploy v2.1.0 to production",
        "simulation": {
            "type": "shell_preview",
            "preview": {
                "command": "wrangler deploy --env production",
                "working_dir": "/app",
                "predicted_effects": [
                    "Replaces running Worker with new version",
                    "~2s downtime during deployment",
                    "Durable Object migrations will run"
                ]
            },
            "impact": {
                "services_affected": ["api", "websocket"],
                "reversible": false
            },
            "risk_factors": [
                { "factor": "production_deploy", "severity": "high", "detail": "Affects live users" },
                { "factor": "irreversible", "severity": "high", "detail": "Cannot auto-rollback DO migrations" }
            ]
        }
    }
}
```

### Example: File Operations

```json
{
    "tool": "action_submit",
    "params": {
        "action_type": "code_write",
        "risk_level": "medium",
        "trigger_message_id": 42,
        "description": "Scaffold new API module",
        "simulation": {
            "type": "file_ops",
            "preview": {
                "operations": [
                    { "path": "src/routes/api/billing/+server.ts", "op": "create" },
                    { "path": "src/routes/api/billing/webhook/+server.ts", "op": "create" },
                    { "path": "src/lib/server/stripe.ts", "op": "create" },
                    { "path": "src/lib/server/db/schema.ts", "op": "modify" }
                ]
            },
            "impact": {
                "files_modified": 4,
                "services_affected": ["billing"],
                "reversible": true
            }
        }
    }
}
```

### Example: API Call

```json
{
    "tool": "action_submit",
    "params": {
        "action_type": "config_change",
        "risk_level": "high",
        "trigger_message_id": 42,
        "description": "Create Stripe webhook endpoint",
        "simulation": {
            "type": "api_call",
            "preview": {
                "method": "POST",
                "url": "https://api.stripe.com/v1/webhook_endpoints",
                "body": "{\n  \"url\": \"https://martol.app/api/billing/webhook\",\n  \"enabled_events\": [\"checkout.session.completed\", \"invoice.paid\"]\n}"
            },
            "impact": {
                "services_affected": ["stripe"],
                "reversible": true
            }
        }
    }
}
```

### Response

```json
{
    "ok": true,
    "data": {
        "action_id": 123,
        "status": "pending",
        "server_risk": "high"
    }
}
```

The `server_risk` field shows the final risk level after server augmentation, which may differ from the agent's declared `risk_level`.

---

## Preview Payload Shapes

| `simulation_type` | `preview` Shape |
|---|---|
| `code_diff` | `{ file: string, diff: string, lines_added: number, lines_removed: number }` |
| `shell_preview` | `{ command: string, working_dir?: string, predicted_effects?: string[] }` |
| `api_call` | `{ method: string, url: string, headers?: Record<string, string>, body?: string }` |
| `file_ops` | `{ operations: { path: string, op: 'create' \| 'modify' \| 'delete' }[] }` |
| `custom` | `{ markdown: string }` |

The `preview` field is validated as `z.record(z.string(), z.unknown())` at the Zod level — shape enforcement is loose intentionally. The server validates total simulation size (max 50KB serialized) and the frontend renders what it can, falling back gracefully for missing fields.

---

## Server-Side Risk Augmentation

The server derives risk from `ACTION_RISK_MAP` and never trusts the agent's `risk_level` claim:

```
question_answer  → low
code_review      → low
code_write       → medium
code_modify      → high
code_delete      → high
deploy           → high
config_change    → high
```

After mapping, the server checks simulation impact:

- If `simulation.impact.reversible === false` and base risk is `low` → bump to `medium`
- If `simulation.impact.reversible === false` and base risk is `medium` → bump to `high`
- If `reversible` is `true`, `undefined`, or omitted → no change

This augmentation only escalates risk, never reduces it. An agent that omits `reversible` simply doesn't trigger the escalation — the base `ACTION_RISK_MAP` is already server-authoritative and remains the floor.

---

## Approval Outcome Matrix

Unchanged from the pre-simulation system. The preview system extends what humans see, not how authorization works.

| Role | Low Risk | Medium Risk | High Risk |
|------|----------|-------------|-----------|
| Owner | Auto-approve | Auto-approve | Auto-approve |
| Lead | Auto-approve | Auto-approve | Needs owner |
| Member | Auto-approve | Needs lead | Needs owner (restricted) |
| Viewer | Rejected | Rejected | Rejected |
| Agent | Submit only | Submit only | Submit only |

Members cannot submit `code_delete`, `deploy`, or `config_change` at any risk level.

---

## UI: PendingActionLine

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [HIGH] code_modify  by azmi (lead) via code-agent  [Hide preview]│
│ Refactor auth.ts to add JWT validation                           │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ src/auth.ts                                           -1 +3 │ │
│ │ - const token = req.headers.authorization;                   │ │
│ │ + const token = req.headers.authorization;                   │ │
│ │ + if (!verifyJwt(token)) throw new AuthError();              │ │
│ │ + const claims = decodeJwt(token);                           │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 1 file(s) · auth · reversible                                    │
│                                                                  │
│ Agent assessment (unverified):                                   │
│ modifies_auth  Changes authentication logic                      │
│                                                                  │
│ [✓ Approve] [✗ Reject]                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Rendering by Type

| Type | Visual |
|------|--------|
| `code_diff` | File header with +/- counts, diff lines with green (added) / red (removed) / muted (context) backgrounds. Max height 400px with scroll. |
| `shell_preview` | "Command" header, `$ command` in monospace, "Predicted effects" bullet list |
| `api_call` | **METHOD** URL header, request body in monospace pre block |
| `file_ops` | "File operations" header, list of `create`/`modify`/`delete` with color-coded op labels |
| `custom` | Raw text in monospace pre block |
| `null` (no preview) | No preview section — description only (backward-compatible) |

### Expand/Collapse

- Pending actions with preview data: **auto-expanded on first render** (one-time, does not override user toggle)
- Resolved actions (approved/rejected/expired): **collapsed by default**
- Toggle via "Show preview" / "Hide preview" button (44px min touch target) with chevron icon in header row

### Impact Summary

Rendered below the preview block when `estimatedImpact` is present:

```
{files_modified} file(s) · {services_affected.join(', ')} · {reversible | irreversible}
```

`irreversible` renders in danger color.

### Risk Factors

Rendered below impact when `riskFactors` is present, with explicit "Agent assessment (unverified):" header. One line per factor:

```
{factor}  {detail}
```

Factor name color-coded by severity: low = muted, medium = warning, high = danger.

---

## Security Properties

### Preserved from pre-simulation system

| Property | Mechanism |
|----------|-----------|
| Agent-supplied `risk_level` never trusted | `ACTION_RISK_MAP` derives risk from `action_type` only |
| Agent self-approval blocked | `agentUserId === userId` check in approve/reject endpoints + DO handler |
| Atomic approval (no TOCTOU) | `UPDATE ... WHERE status = 'pending'` in all paths |
| Role enforcement on approval | Leads blocked from approving high-risk; members blocked from approve/reject |
| Append-only audit | Action, approver, timestamp, role recorded immutably |

### Added for preview system

| Property | Mechanism |
|----------|-----------|
| Simulation size limit | Server rejects total simulation object > 50KB serialized (under 64KB MCP transport guard) |
| Array bounds | `services_affected` capped at 20, `risk_factors` capped at 10 |
| Query safety cap | `allPending` query limited to 200 rows (prevents memory exhaustion from action flooding) |
| No code execution | Preview payload stored as JSONB, rendered as text — never evaluated or executed |
| No XSS | All preview content rendered via Svelte text interpolation (auto-escaped), no `{@html}` |
| Risk escalation only | `reversible: false` can bump risk up but nothing can reduce it below `ACTION_RISK_MAP` floor |
| Unverified label | Agent-supplied risk factors visually distinguished from server-derived risk level |

### Trust boundaries

| What humans see | Source | Verified? |
|-----------------|--------|-----------|
| Risk level badge (HIGH/MEDIUM/LOW) | Server-derived from `ACTION_RISK_MAP` | Yes |
| Action type | Agent-declared, server-validated enum | Yes (valid type) |
| Description text | Agent-supplied | No |
| Code diff / shell preview / etc. | Agent-supplied | No |
| Risk factors | Agent-supplied | No — labeled "unverified" in UI |
| Impact assessment | Agent-supplied | No |

---

## Files

| File | Role |
|------|------|
| `src/lib/server/db/schema.ts:170-173` | Schema: 4 nullable columns on `pending_actions` |
| `src/lib/types/mcp.ts:57-70` | Zod: `simulation` field on `actionSubmitSchema` |
| `src/lib/server/mcp/tools/action-submit.ts` | Server: validation, risk augmentation, DB insert |
| `src/lib/types/chat.ts:17-20` | Client type: `PendingAction` with simulation fields |
| `src/routes/api/actions/+server.ts` | API: returns simulation fields in response |
| `src/lib/components/chat/ChatView.svelte:55-76` | Mapping: API snake_case → camelCase |
| `src/lib/components/chat/PendingActionLine.svelte` | UI: preview rendering with trust labels |
| `messages/en.json` | i18n: simulation + status keys |
| `drizzle/0006_dashing_black_widow.sql` | Migration: ALTER TABLE for 4 new columns |

---

## Backward Compatibility

The simulation field is optional at every layer:

- **MCP tool**: `simulation` is `z.optional()` — agents that omit it work identically to before
- **Database**: All 4 columns are nullable — existing rows have `NULL`
- **API**: Response includes `simulation_type: null` etc. for actions without preview data
- **UI**: `PendingActionLine` only renders the preview section when `simulationType` and `simulationPayload` are non-null

No breaking changes to existing agents or API consumers.

---

## Known Limitations

1. **Single preview type per action** — Real operations are composite (build + deploy + config). Agents must choose one type or use `custom` markdown. Multi-step preview support deferred to v2.
2. **No post-approval verification** — The server cannot verify that the agent's actual behavior matches its declared preview. The audit log records the declaration, not the execution.
3. **Preview trust asymmetry** — Actions with previews may get faster approval than actions without. Users should apply equal scrutiny to both.

---

## Review Findings (2026-03-05)

Six specialized agents reviewed the implementation. Findings and resolutions:

### Fixed

| Finding | Source | Resolution |
|---------|--------|------------|
| "Simulation engine" naming implies server verification | Devil's Advocate | Renamed to "action preview system" throughout docs and code comments |
| Agent-supplied risk factors displayed with same visual authority as server risk | Devil's Advocate, Security | Added "Agent assessment (unverified):" header and distinct styling |
| martol-client SDK has no `simulation` parameter | Devil's Advocate | Updated `tools.py` with full simulation schema |
| 100KB payload check is dead code (64KB transport guard) | Cloudflare | Lowered to 50KB, validates full simulation object not just preview |
| `services_affected` array has no max length | Security | Added `.max(20)` to Zod schema |
| `$effect` auto-expand overrides user's manual collapse | Devil's Advocate, Svelte, UI/UX | Added `userToggled` guard — auto-expand is one-time only |
| No max-height on diff blocks | Devil's Advocate, UI/UX | Added `max-height: 400px; overflow-y: auto` to `.sim-diff` |
| Diff blank-line doubling in `<pre>` template | Svelte | Fixed template whitespace in `{#each}` loop |
| Expand/collapse toggle has inadequate touch target | UI/UX | Added `min-h-[44px] min-w-[44px]` |
| Status badge uses raw English | UI/UX | Added i18n keys for all status values |

### Accepted risks

| Finding | Source | Rationale |
|---------|--------|-----------|
| Risk augmentation bypass by omitting `reversible` | Security | Agents gain nothing — `ACTION_RISK_MAP` is the floor, augmentation only escalates |
| Single simulation type per action | Devil's Advocate | Design limitation. `custom` type serves as escape hatch. Multi-step deferred to v2 |
| Preview trust asymmetry (richer previews get faster approval) | Devil's Advocate | Mitigated by "unverified" label. Cannot fully prevent without verification system |
| `simulationPayload` is JSONB not TEXT | Database | JSONB enables future query capabilities. Parse overhead negligible for current scale |

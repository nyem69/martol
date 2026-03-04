# Agent Simulation Engine

**Date:** 2026-03-04
**Status:** Implemented (Phase 2 of pre-launch feature plan)

---

## What It Does

The simulation engine lets agents submit structured previews alongside their action intents. Instead of seeing "Agent wants to modify auth.ts", humans see the actual diff, the impact assessment, and the risk factors — then approve, edit, or reject with full context.

This is additive. Agents that don't send simulation data still work exactly as before — the approval card shows the text description only.

---

## Architecture

```
Agent submits action_submit with simulation object
    ↓
Server validates payload size (max 100KB)
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

No new routes. No new components. No new API endpoints. The simulation engine extends the existing action approval pipeline end-to-end.

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
| `risk_factors` | `JSONB` | Array of `{ factor, severity, detail }` — agent-supplied risk explanations |
| `estimated_impact` | `JSONB` | `{ files_modified?, services_affected?, reversible? }` |

All nullable. Existing actions (without simulation) have `NULL` in all four columns.

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
        services_affected: z.array(z.string()).optional(),
        reversible: z.boolean().optional(),
    }).optional(),
    risk_factors: z.array(z.object({
        factor: z.string().max(100),
        severity: z.enum(['low', 'medium', 'high']),
        detail: z.string().max(500),
    })).max(10).optional(),
}).optional()
```

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

## Simulation Preview Payload Shapes

| `simulation_type` | `preview` Shape |
|---|---|
| `code_diff` | `{ file: string, diff: string, lines_added: number, lines_removed: number }` |
| `shell_preview` | `{ command: string, working_dir?: string, predicted_effects?: string[] }` |
| `api_call` | `{ method: string, url: string, headers?: Record<string, string>, body?: string }` |
| `file_ops` | `{ operations: { path: string, op: 'create' \| 'modify' \| 'delete' }[] }` |
| `custom` | `{ markdown: string }` |

The `preview` field is validated as `z.record(z.string(), z.unknown())` at the Zod level — shape enforcement is loose intentionally. The server validates total payload size (max 100KB serialized) and the frontend renders what it can, falling back gracefully for missing fields.

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

Unchanged from the pre-simulation system. The simulation engine extends what humans see, not how authorization works.

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
│ modifies_auth  Changes authentication logic                      │
│                                                                  │
│ [✓ Approve] [✗ Reject]                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Rendering by Type

| Type | Visual |
|------|--------|
| `code_diff` | File header with +/- counts, diff lines with green (added) / red (removed) / muted (context) backgrounds |
| `shell_preview` | "Command" header, `$ command` in monospace, "Predicted effects" bullet list |
| `api_call` | **METHOD** URL header, request body in monospace pre block |
| `file_ops` | "File operations" header, list of `create`/`modify`/`delete` with color-coded op labels |
| `custom` | Raw text in monospace pre block |
| `null` (no simulation) | No preview section — description only (backward-compatible) |

### Expand/Collapse

- Pending actions with simulation data: **auto-expanded**
- Resolved actions (approved/rejected/expired): **collapsed by default**
- Toggle via "Show preview" / "Hide preview" button with chevron icon in header row

### Impact Summary

Rendered below the preview block when `estimatedImpact` is present:

```
{files_modified} file(s) · {services_affected.join(', ')} · {reversible | irreversible}
```

`irreversible` renders in danger color.

### Risk Factors

Rendered below impact when `riskFactors` is present. One line per factor:

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

### Added for simulation

| Property | Mechanism |
|----------|-----------|
| Payload size limit | Server rejects simulation preview > 100KB serialized |
| Query safety cap | `allPending` query limited to 200 rows (prevents memory exhaustion from action flooding) |
| No code execution | Simulation payload stored as JSONB, rendered as text — never evaluated or executed |
| No XSS | All simulation content rendered via Svelte text interpolation (auto-escaped), no `{@html}` |
| Risk escalation only | `reversible: false` can bump risk up but nothing can reduce it below `ACTION_RISK_MAP` floor |

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
| `src/lib/components/chat/PendingActionLine.svelte` | UI: simulation preview rendering |
| `messages/en.json` | i18n: 11 simulation-related keys |
| `drizzle/0006_dashing_black_widow.sql` | Migration: ALTER TABLE for 4 new columns |

---

## Backward Compatibility

The simulation field is optional at every layer:

- **MCP tool**: `simulation` is `z.optional()` — agents that omit it work identically to before
- **Database**: All 4 columns are nullable — existing rows have `NULL`
- **API**: Response includes `simulation_type: null` etc. for actions without simulation
- **UI**: `PendingActionLine` only renders the preview section when `simulationType` and `simulationPayload` are non-null

No breaking changes to existing agents or API consumers.

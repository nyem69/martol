# Agent Simulation Engine — Design

**Date:** 2026-03-04
**Status:** Approved
**Source:** Phase 2 in `docs/008-Features-Plan.md`, OpenClaw study in `_data/006-OpenClaw.md`

---

## Goal

Transform the existing action approval system from text-only descriptions into rich simulation previews. Agents submit structured preview data (diffs, shell commands, API calls) alongside their intents. Humans see exactly what will happen before approving.

**This is the killer feature.** The approval card with a visible diff IS the product screenshot.

---

## Scope

1. **Schema**: Add 4 columns to `pending_actions` for simulation data
2. **MCP tool**: Extend `action_submit` to accept optional `simulation` object
3. **API**: Return simulation fields from GET `/api/actions`
4. **Types**: Extend `PendingAction` interface
5. **UI**: Expandable simulation preview in `PendingActionLine.svelte`
6. **Risk scoring**: Server augments agent-declared risk based on simulation content
7. **i18n**: Add keys for simulation UI labels

No new routes. No new components (simulation preview is inline in PendingActionLine). No new API endpoints.

---

## 1. Schema Extension

Add 4 nullable columns to `pending_actions`:

```
simulation_type    TEXT        -- 'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom' | NULL
simulation_payload JSONB       -- structured preview data (type-specific shape)
risk_factors       JSONB       -- [{ factor: string, severity: 'low'|'medium'|'high', detail: string }]
estimated_impact   JSONB       -- { files_modified?: number, services_affected?: string[], reversible?: boolean }
```

All nullable — agents that don't send simulation data still work. The approval card shows description-only (current behavior) when simulation is absent.

### Payload Shapes by Type

```typescript
// code_diff
{ file: string, diff: string, lines_added: number, lines_removed: number }

// shell_preview
{ command: string, working_dir?: string, predicted_effects?: string[] }

// api_call
{ method: string, url: string, headers?: Record<string, string>, body?: string }

// file_ops
{ operations: { path: string, op: 'create' | 'modify' | 'delete' }[] }

// custom
{ markdown: string }
```

No Zod enforcement on payload shape — we validate `simulation_type` is a known enum, but `simulation_payload` is freeform JSONB. The frontend renders what it can and falls back to JSON display.

---

## 2. MCP Tool Extension

Extend `actionSubmitSchema` to accept optional `simulation`:

```typescript
simulation: z.object({
    type: z.enum(['code_diff', 'shell_preview', 'api_call', 'file_ops', 'custom']),
    preview: z.record(z.string(), z.unknown()),
    impact: z.object({
        files_modified: z.number().int().nonnegative().optional(),
        services_affected: z.array(z.string()).optional(),
        reversible: z.boolean().optional()
    }).optional(),
    risk_factors: z.array(z.object({
        factor: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        detail: z.string()
    })).max(10).optional()
}).optional()
```

In `actionSubmit()`:
- Extract `simulation.type` → `simulation_type` column
- Extract `simulation.preview` → `simulation_payload` column
- Extract `simulation.risk_factors` → `risk_factors` column
- Extract `simulation.impact` → `estimated_impact` column

### Server Risk Augmentation

After deriving `serverRisk` from `ACTION_RISK_MAP`, check simulation data:

```
if (simulation?.impact?.reversible === false && serverRisk === 'low') → bump to 'medium'
if (simulation?.impact?.reversible === false && serverRisk === 'medium') → bump to 'high'
```

Agent-supplied `risk_factors` are stored for display but don't influence the risk level. Only `reversible: false` triggers a bump. This keeps the risk engine simple and server-authoritative.

---

## 3. API Response Extension

GET `/api/actions` returns additional fields:

```json
{
    "simulation_type": "code_diff" | null,
    "simulation_payload": { ... } | null,
    "risk_factors": [...] | null,
    "estimated_impact": { ... } | null
}
```

No changes to approve/reject endpoints — they don't need simulation data.

---

## 4. Type Extension

```typescript
export interface PendingAction {
    // existing fields...
    simulationType: string | null;
    simulationPayload: Record<string, unknown> | null;
    riskFactors: { factor: string; severity: string; detail: string }[] | null;
    estimatedImpact: { files_modified?: number; services_affected?: string[]; reversible?: boolean } | null;
}
```

---

## 5. UI: PendingActionLine Enhancement

### Layout (expanded state)

```
┌──────────────────────────────────────────────────────────────────┐
│ [HIGH] code_modify  by azmi (lead) via code-agent               │
│ Refactor auth.ts to add JWT validation                          │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ src/auth.ts                                           -1 +3 │ │
│ │ - const token = req.headers.authorization;                   │ │
│ │ + const token = req.headers.authorization;                   │ │
│ │ + if (!verifyJwt(token)) throw new AuthError();              │ │
│ │ + const claims = decodeJwt(token);                           │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Impact: 1 file · auth · reversible                               │
│ Risk: modifies_auth (medium) — Changes authentication logic      │
│                                                                  │
│ [✓ Approve] [✗ Reject]                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Rendering by simulation_type

| Type | Rendering |
|------|-----------|
| `code_diff` | File path header + diff lines with +/- coloring (green/red) |
| `shell_preview` | Monospace command + predicted effects list |
| `api_call` | Method badge + URL + collapsible headers/body |
| `file_ops` | File list with create/modify/delete icons |
| `custom` | Raw markdown (sanitized with existing DOMPurify pipeline) |
| `null` | No preview section (current behavior) |

### Expand/Collapse

- Preview section is collapsed by default for resolved actions (`approved`/`rejected`/`expired`)
- Preview section is expanded by default for `pending` actions
- Toggle via chevron icon in the header row

### Impact Badge

Single line below the preview: `{files_modified} file(s) · {services_affected.join(', ')} · {reversible ? 'reversible' : 'irreversible'}`

Color: `reversible` = muted text, `irreversible` = danger color.

### Risk Factors

Below impact, one line per factor: `{factor} ({severity}) — {detail}`

Severity color-coded: low = muted, medium = warning, high = danger.

---

## 6. Design Constraints

- No external diff library — custom +/- line rendering with CSS (lines starting with `+` get green bg, `-` get red bg, others get neutral)
- No syntax highlighting — monospace font is sufficient for MVP
- No markdown rendering in `custom` type — use the existing `renderMarkdown()` from `$lib/utils/markdown.ts`
- All new strings through paraglide i18n
- Dark theme only
- Responsive: diff block scrolls horizontally on mobile

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/server/db/schema.ts` | Add 4 columns to `pending_actions` |
| `src/lib/types/mcp.ts` | Extend `actionSubmitSchema` with `simulation` |
| `src/lib/server/mcp/tools/action-submit.ts` | Store simulation data, risk augmentation |
| `src/lib/types/chat.ts` | Extend `PendingAction` interface |
| `src/routes/api/actions/+server.ts` | Return simulation fields |
| `src/lib/components/chat/PendingActionLine.svelte` | Simulation preview UI |
| `src/lib/components/chat/ChatView.svelte` | Map new fields from API response |
| `messages/en.json` | Add simulation UI i18n keys |

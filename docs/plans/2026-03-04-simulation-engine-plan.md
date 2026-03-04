# Agent Simulation Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add simulation preview data to the action approval system — agents submit diffs/previews, humans see exactly what will happen before approving.

**Architecture:** Extend existing pending_actions table + MCP tool + PendingActionLine component. No new routes or components.

**Tech Stack:** SvelteKit, Svelte 5 runes, Drizzle ORM, Zod, Tailwind v4, paraglide i18n

---

### Task 1: Add i18n Keys for Simulation UI

**Files:**
- Modify: `messages/en.json`

**Step 1: Add simulation i18n keys**

Add these keys to `messages/en.json` (before the closing `}`):

```json
"action_simulation_preview": "Preview",
"action_simulation_impact": "{count} file(s)",
"action_simulation_reversible": "reversible",
"action_simulation_irreversible": "irreversible",
"action_simulation_risk_factor": "{factor} ({severity})",
"action_simulation_collapse": "Hide preview",
"action_simulation_expand": "Show preview",
"action_simulation_diff_header": "{file}",
"action_simulation_shell_command": "Command",
"action_simulation_shell_effects": "Predicted effects",
"action_simulation_api_method": "{method} {url}",
"action_simulation_file_ops": "File operations"
```

**Step 2: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: Only pre-existing errors.

**Step 3: Commit**

```bash
git add messages/en.json
git commit -m "i18n: add simulation engine UI keys"
```

---

### Task 2: Extend Database Schema

**Files:**
- Modify: `src/lib/server/db/schema.ts`

**Step 1: Add 4 columns to pendingActions**

Add these columns to the `pendingActions` table definition, after the `payloadJson` column and before `status`:

```typescript
simulationType: text('simulation_type').$type<'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom'>(),
simulationPayload: jsonb('simulation_payload'),
riskFactors: jsonb('risk_factors'),
estimatedImpact: jsonb('estimated_impact'),
```

All columns are nullable by default (no `.notNull()`).

**Step 2: Generate migration**

Run: `pnpm db:generate`

This creates a new migration file in `drizzle/` that adds the 4 columns.

**Step 3: Push schema to dev DB**

Run: `pnpm db:push`

This applies the schema change directly (dev workflow).

**Step 4: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat: add simulation columns to pending_actions schema"
```

---

### Task 3: Extend MCP Types and action_submit Tool

**Files:**
- Modify: `src/lib/types/mcp.ts`
- Modify: `src/lib/server/mcp/tools/action-submit.ts`

**Step 1: Extend actionSubmitSchema in mcp.ts**

Add an optional `simulation` field to the `actionSubmitSchema` params:

```typescript
export const actionSubmitSchema = z.object({
	tool: z.literal('action_submit'),
	params: z.object({
		action_type: z.enum([
			'question_answer',
			'code_review',
			'code_write',
			'code_modify',
			'code_delete',
			'deploy',
			'config_change',
		]),
		risk_level: z.enum(['low', 'medium', 'high']),
		trigger_message_id: z.number().int().positive(),
		description: z.string().min(1).max(2000),
		payload: z.record(z.string(), z.unknown()).optional(),
		simulation: z.object({
			type: z.enum(['code_diff', 'shell_preview', 'api_call', 'file_ops', 'custom']),
			preview: z.record(z.string(), z.unknown()),
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
		}).optional(),
	}),
});
```

Update `ActionSubmitResult` to include simulation status:

```typescript
export interface ActionSubmitResult {
	action_id: number;
	status: 'approved' | 'pending' | 'rejected';
	server_risk: string;
}
```

**Step 2: Update action-submit.ts to store simulation data + augment risk**

In `actionSubmit()`, update the params type to include `simulation`:

```typescript
export async function actionSubmit(
	params: {
		action_type: ActionType;
		risk_level: RiskLevel;
		trigger_message_id: number;
		description: string;
		payload?: Record<string, unknown>;
		simulation?: {
			type: 'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom';
			preview: Record<string, unknown>;
			impact?: {
				files_modified?: number;
				services_affected?: string[];
				reversible?: boolean;
			};
			risk_factors?: { factor: string; severity: string; detail: string }[];
		};
	},
	agent: AgentContext,
	db: any
): Promise<McpResponse<ActionSubmitResult>> {
```

After deriving `serverRisk` from `ACTION_RISK_MAP`, add risk augmentation:

```typescript
// 4. Server-derive risk level — never trust agent's claimed value
let serverRisk = ACTION_RISK_MAP[params.action_type];

// 4a. Augment risk based on simulation impact
if (params.simulation?.impact?.reversible === false) {
    if (serverRisk === 'low') serverRisk = 'medium';
    else if (serverRisk === 'medium') serverRisk = 'high';
}
```

Update the insert to include simulation columns:

```typescript
const [action] = await db
    .insert(pendingActions)
    .values({
        orgId: agent.orgId,
        triggerMessageId: params.trigger_message_id,
        requestedBy: triggerMsg.senderId,
        requestedRole: triggerMsg.senderRole,
        agentUserId: agent.agentUserId,
        actionType: params.action_type,
        riskLevel: serverRisk,
        description: params.description,
        payloadJson: {
            ...(params.payload ?? {}),
            _claimed_risk_level: params.risk_level
        },
        simulationType: params.simulation?.type ?? null,
        simulationPayload: params.simulation?.preview ?? null,
        riskFactors: params.simulation?.risk_factors ?? null,
        estimatedImpact: params.simulation?.impact ?? null,
        status,
        approvedBy: outcome === 'direct' ? 'system' : null,
        approvedAt: outcome === 'direct' ? new Date() : null
    })
    .returning({ id: pendingActions.id });

return {
    ok: true,
    data: { action_id: action.id, status: status as 'approved' | 'pending', server_risk: serverRisk }
};
```

**Step 3: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/lib/types/mcp.ts src/lib/server/mcp/tools/action-submit.ts
git commit -m "feat: extend action_submit MCP tool with simulation data"
```

---

### Task 4: Extend API Response and Client Types

**Files:**
- Modify: `src/routes/api/actions/+server.ts`
- Modify: `src/lib/types/chat.ts`
- Modify: `src/lib/components/chat/ChatView.svelte`

**Step 1: Add simulation fields to select and response in +server.ts**

Add to `selectFields`:

```typescript
const selectFields = {
    // ...existing fields...
    simulationType: pendingActions.simulationType,
    simulationPayload: pendingActions.simulationPayload,
    riskFactors: pendingActions.riskFactors,
    estimatedImpact: pendingActions.estimatedImpact,
};
```

Add to the response mapping:

```typescript
data: actions.map((a: typeof actions[number]) => ({
    // ...existing fields...
    simulation_type: a.simulationType ?? null,
    simulation_payload: a.simulationPayload ?? null,
    risk_factors: a.riskFactors ?? null,
    estimated_impact: a.estimatedImpact ?? null,
}))
```

**Step 2: Extend PendingAction in chat.ts**

```typescript
export interface PendingAction {
    id: number;
    actionType: string;
    riskLevel: 'low' | 'medium' | 'high';
    description: string;
    requestedBy: string;
    requestedRole: string;
    agentName: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
    timestamp: string;
    simulationType: string | null;
    simulationPayload: Record<string, unknown> | null;
    riskFactors: { factor: string; severity: string; detail: string }[] | null;
    estimatedImpact: { files_modified?: number; services_affected?: string[]; reversible?: boolean } | null;
}
```

**Step 3: Update loadRecentActions mapping in ChatView.svelte**

In the `loadRecentActions()` function, add the new fields to the mapping:

```typescript
recentActions = json.data.map((a) => ({
    // ...existing fields...
    simulationType: (a.simulation_type as string) ?? null,
    simulationPayload: (a.simulation_payload as Record<string, unknown>) ?? null,
    riskFactors: (a.risk_factors as { factor: string; severity: string; detail: string }[]) ?? null,
    estimatedImpact: (a.estimated_impact as { files_modified?: number; services_affected?: string[]; reversible?: boolean }) ?? null,
}));
```

**Step 4: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/routes/api/actions/+server.ts src/lib/types/chat.ts src/lib/components/chat/ChatView.svelte
git commit -m "feat: pass simulation data through API to client"
```

---

### Task 5: Build Simulation Preview UI

**Files:**
- Modify: `src/lib/components/chat/PendingActionLine.svelte`

**Step 1: Add expand/collapse state and simulation rendering**

This is the largest task. The updated `PendingActionLine.svelte` should:

1. Add imports: `ChevronDown`, `ChevronUp` from `@lucide/svelte`
2. Add state: `let expanded = $state(action.status === 'pending' && !!action.simulationType)`
3. Add `hasSim` derived: `const hasSim = $derived(!!action.simulationType && !!action.simulationPayload)`
4. Add expand toggle button in the header row (only visible when `hasSim`)
5. Add simulation preview section (conditionally rendered when `expanded && hasSim`):

**Diff renderer** (for `code_diff` type):
```svelte
{#if action.simulationType === 'code_diff'}
    {@const preview = action.simulationPayload as { file?: string; diff?: string; lines_added?: number; lines_removed?: number }}
    <div class="sim-block">
        <div class="sim-file-header">
            <span>{preview.file ?? 'unknown'}</span>
            {#if preview.lines_removed}<span class="text-red">-{preview.lines_removed}</span>{/if}
            {#if preview.lines_added}<span class="text-green">+{preview.lines_added}</span>{/if}
        </div>
        <pre class="sim-diff">{#each (preview.diff ?? '').split('\n') as line}{@const cls = line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'diff-ctx'}<span class={cls}>{line}</span>
{/each}</pre>
    </div>
{/if}
```

**Shell renderer** (for `shell_preview` type):
```svelte
{#if action.simulationType === 'shell_preview'}
    {@const preview = action.simulationPayload as { command?: string; working_dir?: string; predicted_effects?: string[] }}
    <div class="sim-block">
        <pre class="sim-shell">$ {preview.command ?? ''}</pre>
        {#if preview.predicted_effects?.length}
            <ul class="sim-effects">
                {#each preview.predicted_effects as effect}
                    <li>{effect}</li>
                {/each}
            </ul>
        {/if}
    </div>
{/if}
```

**API call renderer** (for `api_call` type):
```svelte
{#if action.simulationType === 'api_call'}
    {@const preview = action.simulationPayload as { method?: string; url?: string; headers?: Record<string, string>; body?: string }}
    <div class="sim-block">
        <div class="sim-api-method">
            <span class="font-bold">{preview.method ?? 'GET'}</span>
            <span>{preview.url ?? ''}</span>
        </div>
        {#if preview.body}
            <pre class="sim-api-body">{preview.body}</pre>
        {/if}
    </div>
{/if}
```

**File ops renderer** (for `file_ops` type):
```svelte
{#if action.simulationType === 'file_ops'}
    {@const preview = action.simulationPayload as { operations?: { path: string; op: string }[] }}
    <div class="sim-block">
        {#each preview.operations ?? [] as op}
            <div class="sim-file-op">
                <span class={op.op === 'create' ? 'text-green' : op.op === 'delete' ? 'text-red' : 'text-yellow'}>{op.op}</span>
                <span>{op.path}</span>
            </div>
        {/each}
    </div>
{/if}
```

**Custom renderer** (for `custom` type):
```svelte
{#if action.simulationType === 'custom'}
    {@const preview = action.simulationPayload as { markdown?: string }}
    <div class="sim-block">
        <pre class="sim-custom">{preview.markdown ?? ''}</pre>
    </div>
{/if}
```

6. Add impact summary line (below preview, when `estimatedImpact` exists):

```svelte
{#if action.estimatedImpact}
    <div class="sim-impact">
        {#if action.estimatedImpact.files_modified != null}
            <span>{m.action_simulation_impact({ count: String(action.estimatedImpact.files_modified) })}</span>
        {/if}
        {#if action.estimatedImpact.services_affected?.length}
            <span>· {action.estimatedImpact.services_affected.join(', ')}</span>
        {/if}
        {#if action.estimatedImpact.reversible != null}
            <span class={action.estimatedImpact.reversible ? '' : 'text-danger'}>
                · {action.estimatedImpact.reversible ? m.action_simulation_reversible() : m.action_simulation_irreversible()}
            </span>
        {/if}
    </div>
{/if}
```

7. Add risk factors (below impact, when `riskFactors` exists):

```svelte
{#if action.riskFactors?.length}
    <div class="sim-risks">
        {#each action.riskFactors as rf}
            <div class="sim-risk-factor">
                <span class="risk-badge" style="color: {rf.severity === 'high' ? 'var(--danger)' : rf.severity === 'medium' ? 'var(--warning)' : 'var(--text-muted)'};">
                    {rf.factor}
                </span>
                <span style="color: var(--text-muted);">{rf.detail}</span>
            </div>
        {/each}
    </div>
{/if}
```

**Step 2: Add CSS for simulation preview**

Add styles in the component's `<style>` block or use Tailwind utility classes inline. Key styles:

```css
.sim-block {
    margin: 8px 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    font-size: 12px;
}

.sim-file-header {
    display: flex;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-elevated);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
}

.sim-diff {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre;
    background: var(--bg);
}

.diff-add {
    display: block;
    color: var(--success);
    background: oklch(from var(--success) l c h / 0.1);
}

.diff-del {
    display: block;
    color: var(--danger);
    background: oklch(from var(--danger) l c h / 0.1);
}

.diff-ctx {
    display: block;
    color: var(--text-muted);
}

.sim-shell {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
}

.sim-effects {
    padding: 4px 10px 8px 24px;
    font-size: 12px;
    color: var(--text-muted);
}

.sim-api-method {
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
}

.sim-api-body {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-x: auto;
    white-space: pre;
    background: var(--bg);
}

.sim-file-op {
    display: flex;
    gap: 8px;
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
}

.sim-custom {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    background: var(--bg);
}

.sim-impact {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin-top: 6px;
}

.sim-risks {
    margin-top: 4px;
}

.sim-risk-factor {
    display: flex;
    gap: 6px;
    font-size: 11px;
    line-height: 1.6;
}

.risk-badge {
    font-family: var(--font-mono);
    font-weight: 500;
}
```

**Step 3: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: No new errors.

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/lib/components/chat/PendingActionLine.svelte
git commit -m "feat: simulation preview UI in action approval cards"
```

---

### Task 6: Final Verification

**Step 1: Full build check**

Run: `pnpm check && pnpm build`
Expected: Both pass.

**Step 2: Manual test scenarios**

Start dev server: `pnpm dev`

Test with MCP tool call (use curl or agent):

```json
{
    "tool": "action_submit",
    "params": {
        "action_type": "code_modify",
        "risk_level": "medium",
        "trigger_message_id": 1,
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
                { "factor": "modifies_auth", "severity": "medium", "detail": "Changes authentication logic" }
            ]
        }
    }
}
```

Verify:
- Action card shows diff preview with green/red lines
- Impact line shows "1 file(s) · auth · reversible"
- Risk factor shows "modifies_auth (medium) — Changes authentication logic"
- Expand/collapse toggle works
- Approve/reject buttons still work
- Actions without simulation data render as before (description only)

**Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: simulation engine adjustments"
```

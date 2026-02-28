# MCP Endpoint (`/mcp/v1`) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the authenticated MCP HTTP endpoint that agents use to interact with chat rooms — send/read messages, manage cursors, list members, submit structured actions, and check action status.

**Architecture:** A single SvelteKit API route (`POST /mcp/v1`) that authenticates via Better Auth `apiKey` plugin, resolves the agent's org binding from the `agent_room_bindings` table, then dispatches to per-tool handlers. Each tool handler operates on PostgreSQL (via Drizzle) and/or the ChatRoom Durable Object (via HTTP stub). The agent's identity is always server-derived from the API key — never from the request payload.

**Tech Stack:** SvelteKit `+server.ts`, Zod (request validation), Drizzle ORM (PostgreSQL), Better Auth `apiKey` plugin, Cloudflare Durable Objects (HTTP POST to ChatRoom), Cloudflare KV (key revocation check).

---

## Task 1: Define MCP Types and Zod Schemas

**Files:**
- Create: `src/lib/types/mcp.ts`

**Step 1: Write the MCP type definitions and Zod schemas**

```typescript
import { z } from 'zod';

// ── Tool request schemas ─────────────────────────────────────

export const chatSendSchema = z.object({
  tool: z.literal('chat_send'),
  params: z.object({
    body: z.string().min(1).max(32768),
    replyTo: z.number().int().positive().optional(),
  }),
});

export const chatReadSchema = z.object({
  tool: z.literal('chat_read'),
  params: z.object({
    limit: z.number().int().min(1).max(200).default(50),
  }).default({}),
});

export const chatResyncSchema = z.object({
  tool: z.literal('chat_resync'),
  params: z.object({
    limit: z.number().int().min(1).max(200).default(50),
  }).default({}),
});

export const chatJoinSchema = z.object({
  tool: z.literal('chat_join'),
  params: z.object({}).default({}),
});

export const chatWhoSchema = z.object({
  tool: z.literal('chat_who'),
  params: z.object({}).default({}),
});

export const actionSubmitSchema = z.object({
  tool: z.literal('action_submit'),
  params: z.object({
    action_type: z.enum([
      'question_answer', 'code_review', 'code_write',
      'code_modify', 'code_delete', 'deploy', 'config_change',
    ]),
    risk_level: z.enum(['low', 'medium', 'high']),
    trigger_message_id: z.number().int().positive(),
    description: z.string().min(1).max(2000),
    payload: z.record(z.unknown()).optional(),
  }),
});

export const actionStatusSchema = z.object({
  tool: z.literal('action_status'),
  params: z.object({
    action_id: z.number().int().positive(),
  }),
});

export const mcpRequestSchema = z.discriminatedUnion('tool', [
  chatSendSchema,
  chatReadSchema,
  chatResyncSchema,
  chatJoinSchema,
  chatWhoSchema,
  actionSubmitSchema,
  actionStatusSchema,
]);

export type McpRequest = z.infer<typeof mcpRequestSchema>;

// ── Response types ───────────────────────────────────────────

export interface McpSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface McpError {
  ok: false;
  error: string;
  code: string;
}

export type McpResponse<T = unknown> = McpSuccess<T> | McpError;

// ── Tool response data types ─────────────────────────────────

export interface ChatSendResult {
  message_id: number;
  timestamp: string;
}

export interface ChatMessage {
  id: number;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  reply_to: number | null;
  timestamp: string;
}

export interface ChatReadResult {
  messages: ChatMessage[];
  cursor: number;
  has_more: boolean;
}

export interface ChatWhoMember {
  user_id: string;
  name: string;
  role: string;
  is_agent: boolean;
}

export interface ChatWhoResult {
  room_id: string;
  room_name: string;
  members: ChatWhoMember[];
}

export interface ActionSubmitResult {
  action_id: number;
  status: 'approved' | 'pending' | 'rejected';
}

export interface ActionStatusResult {
  action_id: number;
  status: string;
  action_type: string;
  risk_level: string;
  description: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}
```

**Step 2: Verify the file has no syntax errors**

Run: `pnpm exec tsc --noEmit src/lib/types/mcp.ts 2>&1 || true`

Note: Full type check later with `pnpm check`. Just verify no obvious syntax issues.

**Step 3: Commit**

```bash
git add src/lib/types/mcp.ts
git commit -m "feat(mcp): add MCP request/response types and Zod schemas"
```

---

## Task 2: Install Zod Dependency

**Step 1: Check if Zod is already installed**

Run: `grep '"zod"' package.json`

If not found:

**Step 2: Install Zod**

Run: `pnpm add zod`

**Step 3: Commit (only if Zod was installed)**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add zod dependency for request validation"
```

---

## Task 3: Create API Key Authentication Middleware

**Files:**
- Create: `src/lib/server/mcp/auth.ts`

**Step 1: Write the auth middleware**

This function validates the `x-api-key` header via Better Auth, checks KV for key revocation, and resolves the agent's org binding.

```typescript
import { eq, and } from 'drizzle-orm';
import { agentRoomBindings } from '$lib/server/db/schema';
import { apikey, user, member } from '$lib/server/db/auth-schema';
import type { McpError } from '$lib/types/mcp';

export interface AgentContext {
  agentUserId: string;
  agentName: string;
  orgId: string;
  orgRole: string;
  label: string;
  model: string;
}

type AuthResult =
  | { ok: true; agent: AgentContext }
  | { ok: false; status: number; error: McpError };

/**
 * Authenticate an MCP request via API key.
 *
 * 1. Extract x-api-key header
 * 2. Verify key via Better Auth
 * 3. Check KV for revocation
 * 4. Resolve agent_room_bindings to get orgId + label
 * 5. Verify org membership is active
 */
export async function authenticateAgent(
  request: Request,
  auth: any,
  db: any,
  kv?: KVNamespace
): Promise<AuthResult> {
  const apiKeyHeader = request.headers.get('x-api-key');
  if (!apiKeyHeader) {
    return {
      ok: false,
      status: 401,
      error: { ok: false, error: 'Missing x-api-key header', code: 'auth_missing' },
    };
  }

  // Verify API key via Better Auth
  let keyData: any;
  try {
    keyData = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
  } catch {
    return {
      ok: false,
      status: 401,
      error: { ok: false, error: 'Invalid API key', code: 'auth_invalid' },
    };
  }

  if (!keyData?.valid) {
    return {
      ok: false,
      status: 401,
      error: { ok: false, error: 'Invalid API key', code: 'auth_invalid' },
    };
  }

  const agentUserId = keyData.key?.userId;
  if (!agentUserId) {
    return {
      ok: false,
      status: 401,
      error: { ok: false, error: 'API key has no associated user', code: 'auth_invalid' },
    };
  }

  // Check KV for key revocation (immediate eviction)
  if (kv && keyData.key?.id) {
    const revoked = await kv.get(`revoked:${keyData.key.id}`);
    if (revoked) {
      return {
        ok: false,
        status: 401,
        error: { ok: false, error: 'API key has been revoked', code: 'auth_revoked' },
      };
    }
  }

  // Resolve agent binding (agent must be bound to exactly one room)
  const [binding] = await db
    .select({
      orgId: agentRoomBindings.orgId,
      label: agentRoomBindings.label,
      model: agentRoomBindings.model,
    })
    .from(agentRoomBindings)
    .where(eq(agentRoomBindings.agentUserId, agentUserId))
    .limit(1);

  if (!binding) {
    return {
      ok: false,
      status: 403,
      error: { ok: false, error: 'Agent not bound to any room', code: 'agent_unbound' },
    };
  }

  // Verify org membership is still active
  const [memberRecord] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, binding.orgId), eq(member.userId, agentUserId)))
    .limit(1);

  if (!memberRecord) {
    return {
      ok: false,
      status: 403,
      error: { ok: false, error: 'Agent is not a member of the bound room', code: 'agent_not_member' },
    };
  }

  // Get agent user name
  const [agentUser] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, agentUserId))
    .limit(1);

  return {
    ok: true,
    agent: {
      agentUserId,
      agentName: agentUser?.name ?? binding.label,
      orgId: binding.orgId,
      orgRole: memberRecord.role,
      label: binding.label,
      model: binding.model,
    },
  };
}
```

**Step 2: Verify no syntax errors**

Run: `pnpm check`

Expected: 0 errors (same as before — new file should type-check)

**Step 3: Commit**

```bash
git add src/lib/server/mcp/auth.ts
git commit -m "feat(mcp): add API key auth middleware with KV revocation check"
```

---

## Task 4: Implement `chat_send` Tool Handler

**Files:**
- Create: `src/lib/server/mcp/tools/chat-send.ts`

**Step 1: Write the chat_send handler**

Sends a message by inserting directly into PostgreSQL (not via DO WebSocket — agents use HTTP, not WS). Also broadcasts via DO HTTP POST so connected WebSocket clients see it in real-time.

```typescript
import { eq, and } from 'drizzle-orm';
import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatSendResult, McpResponse } from '$lib/types/mcp';

export async function chatSend(
  params: { body: string; replyTo?: number },
  agent: AgentContext,
  db: any
): Promise<McpResponse<ChatSendResult>> {
  // Validate replyTo exists in the same org if provided
  if (params.replyTo) {
    const [replyMsg] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, params.replyTo), eq(messages.orgId, agent.orgId)))
      .limit(1);

    if (!replyMsg) {
      return { ok: false, error: 'Reply target message not found', code: 'invalid_reply' };
    }
  }

  // Insert message with server-derived sender
  const [inserted] = await db
    .insert(messages)
    .values({
      orgId: agent.orgId,
      senderId: agent.agentUserId,
      senderRole: 'agent' as const,
      type: 'chat' as const,
      body: params.body,
      replyTo: params.replyTo ?? null,
    })
    .returning({ id: messages.id, createdAt: messages.createdAt });

  return {
    ok: true,
    data: {
      message_id: inserted.id,
      timestamp: inserted.createdAt.toISOString(),
    },
  };
}
```

**Step 2: Commit**

```bash
git add src/lib/server/mcp/tools/chat-send.ts
git commit -m "feat(mcp): implement chat_send tool handler"
```

---

## Task 5: Implement `chat_read` and `chat_resync` Tool Handlers

**Files:**
- Create: `src/lib/server/mcp/tools/chat-read.ts`

**Step 1: Write the chat_read and chat_resync handlers**

`chat_read` returns messages since the agent's cursor. `chat_resync` resets the cursor and returns the latest N messages.

```typescript
import { eq, and, gt, desc } from 'drizzle-orm';
import { messages } from '$lib/server/db/schema';
import { agentCursors } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatReadResult, ChatMessage, McpResponse } from '$lib/types/mcp';
import { user } from '$lib/server/db/auth-schema';

async function formatMessages(
  rows: Array<{
    id: number;
    senderId: string;
    senderRole: string;
    body: string;
    replyTo: number | null;
    createdAt: Date;
  }>,
  db: any
): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];

  // Batch-fetch sender names
  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const users = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(
      senderIds.length === 1
        ? eq(user.id, senderIds[0])
        : // For multiple IDs, use inArray
          undefined // will be replaced below
    );

  // Workaround: fetch all and filter (drizzle inArray requires import)
  // Better approach: use sql`IN` or import inArray
  const nameMap = new Map<string, string>();
  // We'll use a simpler approach with individual lookups cached
  for (const row of rows) {
    if (!nameMap.has(row.senderId)) {
      const [u] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, row.senderId))
        .limit(1);
      nameMap.set(row.senderId, u?.name ?? 'Unknown');
    }
  }

  return rows.map((r) => ({
    id: r.id,
    sender_id: r.senderId,
    sender_name: nameMap.get(r.senderId) ?? 'Unknown',
    sender_role: r.senderRole,
    body: r.body,
    reply_to: r.replyTo,
    timestamp: r.createdAt.toISOString(),
  }));
}

export async function chatRead(
  params: { limit: number },
  agent: AgentContext,
  db: any
): Promise<McpResponse<ChatReadResult>> {
  // Get current cursor
  const [cursor] = await db
    .select({ lastReadId: agentCursors.lastReadId })
    .from(agentCursors)
    .where(
      and(eq(agentCursors.orgId, agent.orgId), eq(agentCursors.agentUserId, agent.agentUserId))
    )
    .limit(1);

  const lastReadId = cursor?.lastReadId ?? 0;

  // Fetch messages after cursor
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderRole: messages.senderRole,
      body: messages.body,
      replyTo: messages.replyTo,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, agent.orgId),
        gt(messages.id, lastReadId),
        // Exclude soft-deleted
        eq(messages.deletedAt, null)
      )
    )
    .orderBy(messages.id)
    .limit(params.limit + 1); // +1 to detect has_more

  const hasMore = rows.length > params.limit;
  const resultRows = hasMore ? rows.slice(0, params.limit) : rows;
  const formatted = await formatMessages(resultRows, db);

  // Update cursor to highest message ID seen
  if (resultRows.length > 0) {
    const newCursor = resultRows[resultRows.length - 1].id;
    await db
      .insert(agentCursors)
      .values({
        orgId: agent.orgId,
        agentUserId: agent.agentUserId,
        lastReadId: newCursor,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [agentCursors.orgId, agentCursors.agentUserId],
        set: { lastReadId: newCursor, updatedAt: new Date() },
      });
  }

  return {
    ok: true,
    data: {
      messages: formatted,
      cursor: resultRows.length > 0 ? resultRows[resultRows.length - 1].id : lastReadId,
      has_more: hasMore,
    },
  };
}

export async function chatResync(
  params: { limit: number },
  agent: AgentContext,
  db: any
): Promise<McpResponse<ChatReadResult>> {
  // Get the latest N messages (no cursor filter)
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderRole: messages.senderRole,
      body: messages.body,
      replyTo: messages.replyTo,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.orgId, agent.orgId), eq(messages.deletedAt, null)))
    .orderBy(desc(messages.id))
    .limit(params.limit);

  // Reverse to chronological order
  rows.reverse();
  const formatted = await formatMessages(rows, db);

  // Reset cursor to latest message
  const newCursor = rows.length > 0 ? rows[rows.length - 1].id : 0;
  await db
    .insert(agentCursors)
    .values({
      orgId: agent.orgId,
      agentUserId: agent.agentUserId,
      lastReadId: newCursor,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agentCursors.orgId, agentCursors.agentUserId],
      set: { lastReadId: newCursor, updatedAt: new Date() },
    });

  return {
    ok: true,
    data: {
      messages: formatted,
      cursor: newCursor,
      has_more: false, // resync always starts fresh
    },
  };
}
```

**Step 2: Run type check**

Run: `pnpm check`

Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/mcp/tools/chat-read.ts
git commit -m "feat(mcp): implement chat_read and chat_resync tool handlers"
```

---

## Task 6: Implement `chat_join` and `chat_who` Tool Handlers

**Files:**
- Create: `src/lib/server/mcp/tools/chat-join.ts`
- Create: `src/lib/server/mcp/tools/chat-who.ts`

**Step 1: Write the chat_join handler**

`chat_join` inserts a system "join" message and returns confirmation. Presence is primarily managed via WebSocket, but MCP agents use HTTP — this records the intent.

```typescript
import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

export async function chatJoin(
  agent: AgentContext,
  db: any
): Promise<McpResponse<{ joined: true; room_id: string }>> {
  // Insert a system join message
  await db.insert(messages).values({
    orgId: agent.orgId,
    senderId: agent.agentUserId,
    senderRole: 'agent' as const,
    type: 'join' as const,
    body: `${agent.label} joined the room`,
  });

  return {
    ok: true,
    data: { joined: true, room_id: agent.orgId },
  };
}
```

**Step 2: Write the chat_who handler**

```typescript
import { eq } from 'drizzle-orm';
import { member, user, organization } from '$lib/server/db/auth-schema';
import { agentRoomBindings } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatWhoResult, ChatWhoMember, McpResponse } from '$lib/types/mcp';

export async function chatWho(
  agent: AgentContext,
  db: any
): Promise<McpResponse<ChatWhoResult>> {
  // Get room name
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, agent.orgId))
    .limit(1);

  // Get all members with user info
  const members = await db
    .select({
      userId: member.userId,
      role: member.role,
      name: user.name,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, agent.orgId));

  // Get agent bindings to identify which members are agents
  const agentBindings = await db
    .select({ agentUserId: agentRoomBindings.agentUserId })
    .from(agentRoomBindings)
    .where(eq(agentRoomBindings.orgId, agent.orgId));

  const agentUserIds = new Set(agentBindings.map((b: any) => b.agentUserId));

  const result: ChatWhoMember[] = members.map((m: any) => ({
    user_id: m.userId,
    name: m.name,
    role: m.role,
    is_agent: agentUserIds.has(m.userId),
  }));

  return {
    ok: true,
    data: {
      room_id: agent.orgId,
      room_name: org?.name ?? 'Unknown',
      members: result,
    },
  };
}
```

**Step 3: Commit**

```bash
git add src/lib/server/mcp/tools/chat-join.ts src/lib/server/mcp/tools/chat-who.ts
git commit -m "feat(mcp): implement chat_join and chat_who tool handlers"
```

---

## Task 7: Implement `action_submit` and `action_status` Tool Handlers

**Files:**
- Create: `src/lib/server/mcp/tools/action-submit.ts`
- Create: `src/lib/server/mcp/tools/action-status.ts`

**Step 1: Write the action_submit handler**

This is the core action gating implementation. Server validates the trigger message, extracts the requesting human's role, checks the approval matrix, and either approves immediately, creates a pending action, or rejects.

```typescript
import { eq, and } from 'drizzle-orm';
import { messages, pendingActions, agentCursors } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import type { AgentContext } from '../auth';
import type { ActionSubmitResult, McpResponse } from '$lib/types/mcp';

type ActionType =
  | 'question_answer' | 'code_review' | 'code_write'
  | 'code_modify' | 'code_delete' | 'deploy' | 'config_change';
type RiskLevel = 'low' | 'medium' | 'high';
type ApprovalOutcome = 'direct' | 'lead_approve' | 'owner_approve' | 'rejected';

/**
 * Approval matrix: risk_level × sender_role → outcome
 * From docs/001-Features.md
 */
function getApprovalOutcome(
  actionType: ActionType,
  riskLevel: RiskLevel,
  senderRole: string
): ApprovalOutcome {
  // Owner: everything is direct
  if (senderRole === 'owner') return 'direct';

  if (riskLevel === 'low') {
    // Low-risk: direct for everyone (owner, lead, member)
    return 'direct';
  }

  if (riskLevel === 'medium') {
    if (senderRole === 'lead') return 'direct';
    if (senderRole === 'member') return 'lead_approve';
    return 'rejected'; // viewer
  }

  // High-risk
  if (senderRole === 'lead') return 'owner_approve';
  if (senderRole === 'member') {
    // Members rejected for code_delete, deploy, config_change
    if (['code_delete', 'deploy', 'config_change'].includes(actionType)) {
      return 'rejected';
    }
    return 'owner_approve';
  }

  return 'rejected'; // viewer or unknown
}

export async function actionSubmit(
  params: {
    action_type: ActionType;
    risk_level: RiskLevel;
    trigger_message_id: number;
    description: string;
    payload?: Record<string, unknown>;
  },
  agent: AgentContext,
  db: any
): Promise<McpResponse<ActionSubmitResult>> {
  // 1. Look up trigger message — server-derive sender identity
  const [triggerMsg] = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderRole: messages.senderRole,
      orgId: messages.orgId,
    })
    .from(messages)
    .where(
      and(eq(messages.id, params.trigger_message_id), eq(messages.orgId, agent.orgId))
    )
    .limit(1);

  if (!triggerMsg) {
    return {
      ok: false,
      error: 'Trigger message not found in this room',
      code: 'invalid_trigger',
    };
  }

  // 2. Verify agent has read this message (cursor >= trigger_message_id)
  const [cursor] = await db
    .select({ lastReadId: agentCursors.lastReadId })
    .from(agentCursors)
    .where(
      and(
        eq(agentCursors.orgId, agent.orgId),
        eq(agentCursors.agentUserId, agent.agentUserId)
      )
    )
    .limit(1);

  if (!cursor || cursor.lastReadId < params.trigger_message_id) {
    return {
      ok: false,
      error: 'Agent cursor has not read the trigger message',
      code: 'cursor_behind',
    };
  }

  // 3. Verify triggering user is still an active org member
  const [triggerMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, agent.orgId),
        eq(member.userId, triggerMsg.senderId)
      )
    )
    .limit(1);

  if (!triggerMember) {
    return {
      ok: false,
      error: 'Triggering user is no longer a room member',
      code: 'sender_removed',
    };
  }

  // 4. Check approval matrix
  const outcome = getApprovalOutcome(
    params.action_type,
    params.risk_level,
    triggerMsg.senderRole // Use role at time of message, not current role
  );

  if (outcome === 'rejected') {
    return {
      ok: false,
      error: `Action ${params.action_type} with risk ${params.risk_level} rejected for role ${triggerMsg.senderRole}`,
      code: 'action_rejected',
    };
  }

  // 5. Insert pending_action
  const status = outcome === 'direct' ? 'approved' : 'pending';
  const [action] = await db
    .insert(pendingActions)
    .values({
      orgId: agent.orgId,
      triggerMessageId: params.trigger_message_id,
      requestedBy: triggerMsg.senderId,
      requestedRole: triggerMsg.senderRole,
      agentUserId: agent.agentUserId,
      actionType: params.action_type,
      riskLevel: params.risk_level,
      description: params.description,
      payloadJson: params.payload ?? null,
      status,
      approvedBy: outcome === 'direct' ? 'system' : null,
      approvedAt: outcome === 'direct' ? new Date() : null,
    })
    .returning({ id: pendingActions.id });

  return {
    ok: true,
    data: {
      action_id: action.id,
      status: status as 'approved' | 'pending',
    },
  };
}
```

**Step 2: Write the action_status handler**

```typescript
import { eq, and } from 'drizzle-orm';
import { pendingActions } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ActionStatusResult, McpResponse } from '$lib/types/mcp';

export async function actionStatus(
  params: { action_id: number },
  agent: AgentContext,
  db: any
): Promise<McpResponse<ActionStatusResult>> {
  const [action] = await db
    .select({
      id: pendingActions.id,
      status: pendingActions.status,
      actionType: pendingActions.actionType,
      riskLevel: pendingActions.riskLevel,
      description: pendingActions.description,
      createdAt: pendingActions.createdAt,
      approvedBy: pendingActions.approvedBy,
      approvedAt: pendingActions.approvedAt,
    })
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.id, params.action_id),
        eq(pendingActions.orgId, agent.orgId),
        eq(pendingActions.agentUserId, agent.agentUserId)
      )
    )
    .limit(1);

  if (!action) {
    return {
      ok: false,
      error: 'Action not found',
      code: 'action_not_found',
    };
  }

  return {
    ok: true,
    data: {
      action_id: action.id,
      status: action.status,
      action_type: action.actionType,
      risk_level: action.riskLevel,
      description: action.description,
      created_at: action.createdAt.toISOString(),
      approved_by: action.approvedBy,
      approved_at: action.approvedAt?.toISOString() ?? null,
    },
  };
}
```

**Step 3: Run type check**

Run: `pnpm check`

Expected: 0 errors

**Step 4: Commit**

```bash
git add src/lib/server/mcp/tools/action-submit.ts src/lib/server/mcp/tools/action-status.ts
git commit -m "feat(mcp): implement action_submit with approval matrix and action_status"
```

---

## Task 8: Create the MCP Route Handler

**Files:**
- Create: `src/routes/mcp/v1/+server.ts`

**Step 1: Write the route handler that wires auth + dispatch**

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mcpRequestSchema } from '$lib/types/mcp';
import { authenticateAgent } from '$lib/server/mcp/auth';
import { chatSend } from '$lib/server/mcp/tools/chat-send';
import { chatRead, chatResync } from '$lib/server/mcp/tools/chat-read';
import { chatJoin } from '$lib/server/mcp/tools/chat-join';
import { chatWho } from '$lib/server/mcp/tools/chat-who';
import { actionSubmit } from '$lib/server/mcp/tools/action-submit';
import { actionStatus } from '$lib/server/mcp/tools/action-status';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  // 1. Check infrastructure
  if (!locals.auth || !locals.db) {
    error(503, 'Service unavailable');
  }

  // 2. Authenticate agent via API key
  const kv = platform?.env?.CACHE;
  const authResult = await authenticateAgent(request, locals.auth, locals.db, kv);

  if (!authResult.ok) {
    return json(authResult.error, { status: authResult.status });
  }

  const { agent } = authResult;

  // 3. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, error: 'Invalid JSON body', code: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = mcpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'Invalid request',
        code: 'validation_error',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const req = parsed.data;

  // 4. Dispatch to tool handler
  try {
    let result;

    switch (req.tool) {
      case 'chat_send':
        result = await chatSend(req.params, agent, locals.db);
        break;
      case 'chat_read':
        result = await chatRead(req.params, agent, locals.db);
        break;
      case 'chat_resync':
        result = await chatResync(req.params, agent, locals.db);
        break;
      case 'chat_join':
        result = await chatJoin(agent, locals.db);
        break;
      case 'chat_who':
        result = await chatWho(agent, locals.db);
        break;
      case 'action_submit':
        result = await actionSubmit(req.params, agent, locals.db);
        break;
      case 'action_status':
        result = await actionStatus(req.params, agent, locals.db);
        break;
    }

    const status = result.ok ? 200 : (result as any).code === 'action_rejected' ? 403 : 400;
    return json(result, { status });
  } catch (err) {
    console.error('[MCP] Tool handler error:', err);
    return json(
      { ok: false, error: 'Internal error', code: 'internal' },
      { status: 500 }
    );
  }
};
```

**Step 2: Run type check**

Run: `pnpm check`

Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/mcp/v1/+server.ts
git commit -m "feat(mcp): create /mcp/v1 POST route with auth + dispatch"
```

---

## Task 9: Fix `chat_read` — Handle Soft Deletes Properly

The `chat_read` handler uses `eq(messages.deletedAt, null)` which won't work with Drizzle — `null` equality requires `isNull()`.

**Files:**
- Modify: `src/lib/server/mcp/tools/chat-read.ts`

**Step 1: Fix the null check**

Replace `eq(messages.deletedAt, null)` with `isNull(messages.deletedAt)` in both `chatRead` and `chatResync`. Add `isNull` to the drizzle-orm import.

**Step 2: Also fix the `formatMessages` function**

The current implementation does N+1 queries for sender names. Refactor to use `inArray` for batch lookup.

```typescript
import { eq, and, gt, desc, isNull, inArray } from 'drizzle-orm';
```

Replace the `formatMessages` function body:
```typescript
async function formatMessages(
  rows: Array<{
    id: number;
    senderId: string;
    senderRole: string;
    body: string;
    replyTo: number | null;
    createdAt: Date;
  }>,
  db: any
): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];

  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const users = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, senderIds));

  const nameMap = new Map(users.map((u: any) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    sender_id: r.senderId,
    sender_name: nameMap.get(r.senderId) ?? 'Unknown',
    sender_role: r.senderRole,
    body: r.body,
    reply_to: r.replyTo,
    timestamp: r.createdAt.toISOString(),
  }));
}
```

**Step 3: Run type check**

Run: `pnpm check`

Expected: 0 errors

**Step 4: Commit**

```bash
git add src/lib/server/mcp/tools/chat-read.ts
git commit -m "fix(mcp): use isNull for soft delete filter, batch sender name lookups"
```

---

## Task 10: Add `x-api-key` to CORS Allowed Headers

**Files:**
- Modify: `src/hooks.server.ts`

The CORS preflight in `hooks.server.ts` already allows `x-api-key` in `Access-Control-Allow-Headers`. Verify this is the case — if it is, this task is a no-op.

**Step 1: Verify CORS config**

Read `src/hooks.server.ts` and confirm `x-api-key` is in the `Access-Control-Allow-Headers` list.

Run: `grep -n 'x-api-key' src/hooks.server.ts`

Expected: Line containing `'Access-Control-Allow-Headers': '...x-api-key...'`

If present, skip this task. If not, add it.

**Step 2: Commit (only if changes made)**

---

## Task 11: Update CSP `connect-src` for MCP Endpoint

**Files:**
- Modify: `src/hooks.server.ts`

The MCP endpoint is same-origin (`/mcp/v1`), so `'self'` in `connect-src` already covers it. This task is a verification — no changes needed.

**Step 1: Verify CSP**

Run: `grep -n 'connect-src' src/hooks.server.ts`

Confirm `'self'` is present. The MCP endpoint is same-origin, so no CSP change needed.

---

## Task 12: Run Full Type Check and Fix Issues

**Step 1: Run pnpm check**

Run: `pnpm check`

Expected: 0 errors

**Step 2: Fix any type errors found**

Address each error. Common issues:
- Missing imports (inArray, isNull)
- Drizzle `onConflictDoUpdate` syntax for composite keys
- Type narrowing on McpResponse

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(mcp): resolve type errors from full check"
```

---

## Task 13: Manual Smoke Test Plan

This is not automated — it's a checklist for verifying the endpoint works after deployment or in `wrangler dev`.

**Step 1: Start dev server**

Run: `pnpm dev` or `pnpm cf:dev`

**Step 2: Test auth rejection (no key)**

```bash
curl -X POST http://localhost:5190/mcp/v1 \
  -H 'Content-Type: application/json' \
  -d '{"tool": "chat_who", "params": {}}'
```

Expected: `401` with `auth_missing` error.

**Step 3: Test validation rejection (bad body)**

```bash
curl -X POST http://localhost:5190/mcp/v1 \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: test-key-here' \
  -d '{"tool": "invalid_tool"}'
```

Expected: `400` with `validation_error`.

**Step 4: Test with valid API key (requires DB setup)**

Create an agent user, API key, and room binding in the database, then test each tool. This requires a running PostgreSQL instance and proper Better Auth configuration.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Single route | `POST /mcp/v1` | All tools via one endpoint, versioned path |
| Auth method | `x-api-key` header | Better Auth `apiKey` plugin, no session cookies |
| Sender identity | Server-derived from API key | Never trust client payload for identity |
| Message insert | Direct to PostgreSQL | Agents use HTTP, not WebSocket |
| Cursor tracking | `agent_cursors` table with upsert | Persistent across sessions, per-agent per-room |
| Approval matrix | Hardcoded function | Matches `docs/001-Features.md` spec exactly |
| Soft delete filter | `isNull(deletedAt)` | Drizzle-correct null handling |
| Zod validation | Discriminated union on `tool` | Type-safe dispatch, clear error messages |

---

## Verification Checklist

1. `pnpm check` — 0 errors
2. `curl` to `/mcp/v1` without key → 401
3. `curl` with bad JSON → 400
4. `curl` with valid key + `chat_who` → 200 with member list
5. `curl` with valid key + `chat_send` → 200 with message_id
6. `curl` with valid key + `chat_read` → 200 with messages and cursor
7. `curl` with valid key + `action_submit` (low risk) → 200 with `status: "approved"`
8. `curl` with valid key + `action_submit` (high risk from member) → 200 with `status: "pending"` or 403
9. No `sender` field accepted in any request payload

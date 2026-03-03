# Security Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 17 security issues and 6 design gaps identified in `docs/004-SignIn-SignUp.md` §9.

**Architecture:** Five independent batches organized by file cluster to enable parallel execution. Each batch touches a distinct set of files — no conflicts between batches. Fixes follow existing codebase patterns (membership verification, rate limiting, hooks interception).

**Tech Stack:** SvelteKit, Drizzle ORM, Cloudflare KV, Better Auth, Svelte 5 runes, Vitest

---

## Batch 1: Auth Server Core

**Files:**
- Modify: `src/routes/api/auth/magic/+server.ts:34`
- Modify: `src/lib/server/auth/index.ts:96-98,127,136`
- Modify: `src/lib/server/mcp/auth.ts:76-85`
- Modify: `src/lib/server/mcp/auth.test.ts` (update existing test)

### Task 1.1: Fix magic link GET email leak (C2 — Critical)

**Step 1: Edit the GET handler to remove email from redirect URL**

File: `src/routes/api/auth/magic/+server.ts:34`

Replace:
```typescript
redirect(302, `/login?magic=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`);
```

With:
```typescript
redirect(302, `/login?magic=${encodeURIComponent(token)}`);
```

Also remove the email extraction block (lines 24-32) since it's no longer needed in the GET handler. The full GET handler becomes:

```typescript
export const GET: RequestHandler = async ({ url, platform }) => {
	const token = url.searchParams.get('token');
	if (!token) error(400, 'Missing token');

	const kv = platform?.env?.CACHE;
	if (!kv) redirect(302, '/login');

	// Verify token exists in KV (don't consume — prefetch safe)
	const stored = await kv.get(`magic:${token}`);
	if (!stored) redirect(302, '/login?error=expired');

	// Redirect WITHOUT email — email stays server-side only
	redirect(302, `/login?magic=${encodeURIComponent(token)}`);
};
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/api/auth/magic/+server.ts
git commit -m "fix(security): remove email leak from magic link redirect URL (C2)"
```

---

### Task 1.2: Fix inviter email leak in invitation email (H3 — High)

**Step 1: Edit the fallback to never use email**

File: `src/lib/server/auth/index.ts:136`

Replace:
```typescript
const inviterName = inviter.user.name || inviter.user.email;
```

With:
```typescript
const inviterName = inviter.user.name || 'A Martol user';
```

Also fix the dev console.warn at line 127:

Replace:
```typescript
console.warn(`[Auth] DEV ONLY — Invitation for ${email} to ${org.name} from ${inviter.user.email}`);
```

With:
```typescript
console.warn(`[Auth] DEV ONLY — Invitation for ${email} to ${org.name} (inviter: ${inviter.user.name || 'unnamed'})`);
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/auth/index.ts
git commit -m "fix(security): never leak inviter email in invitation template (H3)"
```

---

### Task 1.3: Add production guard for dev fallback magic link (H4 — High)

**Step 1: Replace the else branch with an explicit production guard**

File: `src/lib/server/auth/index.ts:96-98`

Replace:
```typescript
} else {
	// Dev fallback — no KV available
	magicUrl = `${baseURL}/api/auth/verify-otp?email=${encodeURIComponent(email)}&code=${otp}`;
}
```

With:
```typescript
} else if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
	// Dev-only fallback — raw OTP in URL, acceptable for local testing
	magicUrl = `${baseURL}/api/auth/verify-otp?email=${encodeURIComponent(email)}&code=${otp}`;
} else {
	// Production without KV — fail hard rather than expose OTP in URL
	console.error('[Auth] CACHE KV binding missing in production — cannot issue magic link');
	throw new Error('Magic link service unavailable');
}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/auth/index.ts
git commit -m "fix(security): block raw OTP in URL for production without KV (H4)"
```

---

### Task 1.4: Fix agent auth non-deterministic room binding (M4 — Medium)

**Step 1: Add orderBy to agent membership query**

File: `src/lib/server/mcp/auth.ts:76-85`

Replace:
```typescript
const [result] = await db
	.select({
		orgId: member.organizationId,
		role: member.role,
		name: user.name
	})
	.from(member)
	.innerJoin(user, eq(user.id, member.userId))
	.where(and(eq(member.userId, agentUserId), eq(member.role, 'agent')))
	.limit(1);
```

With:
```typescript
const [result] = await db
	.select({
		orgId: member.organizationId,
		role: member.role,
		name: user.name
	})
	.from(member)
	.innerJoin(user, eq(user.id, member.userId))
	.where(and(eq(member.userId, agentUserId), eq(member.role, 'agent')))
	.orderBy(member.createdAt)
	.limit(1);
```

Add `import { asc } from 'drizzle-orm';` at the top if `orderBy` needs explicit direction — Drizzle defaults to ASC.

**Step 2: Update the existing test mock to include orderBy**

File: `src/lib/server/mcp/auth.test.ts` — ensure the mock DB chain includes `orderBy: vi.fn().mockReturnThis()` in the chain builder.

**Step 3: Run tests + typecheck**

Run: `pnpm test -- src/lib/server/mcp/auth.test.ts && pnpm check`
Expected: all pass, 0 errors

**Step 4: Commit**

```bash
git add src/lib/server/mcp/auth.ts src/lib/server/mcp/auth.test.ts
git commit -m "fix(security): deterministic agent room binding with orderBy (M4)"
```

---

## Batch 2: Invitation & Accept Flow

**Files:**
- Modify: `src/routes/accept-invitation/[id]/+page.server.ts:115-129`
- Modify: `src/routes/chat/+page.server.ts:48-64,186-202`
- Modify: `src/lib/components/chat/MemberPanel.svelte`
- Modify: `src/lib/components/chat/ChatView.svelte`

### Task 2.1: Fix invitation decline auth check (C1 — Critical)

**Step 1: Add email ownership verification to the decline action**

File: `src/routes/accept-invitation/[id]/+page.server.ts:115-129`

Replace:
```typescript
decline: async ({ params, locals }) => {
	if (!locals.user || !locals.session) {
		redirect(302, `/login?redirect=/accept-invitation/${params.id}`);
	}

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	await db
		.update(invitation)
		.set({ status: 'rejected' })
		.where(eq(invitation.id, params.id));

	redirect(302, '/chat');
}
```

With:
```typescript
decline: async ({ params, locals }) => {
	if (!locals.user || !locals.session) {
		redirect(302, `/login?redirect=/accept-invitation/${params.id}`);
	}

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Fetch invitation to verify ownership before mutating
	const [invite] = await db
		.select({ email: invitation.email, status: invitation.status })
		.from(invitation)
		.where(eq(invitation.id, params.id))
		.limit(1);

	if (!invite) error(404, 'Invitation not found');

	// Only the invited email can decline
	if (invite.email.toLowerCase() !== locals.user.email!.toLowerCase()) {
		error(403, 'Unauthorized');
	}

	// Only decline if still pending
	if (invite.status !== 'pending') {
		redirect(302, '/chat');
	}

	await db
		.update(invitation)
		.set({ status: 'rejected' })
		.where(eq(invitation.id, params.id));

	redirect(302, '/chat');
}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/accept-invitation/[id]/+page.server.ts
git commit -m "fix(security): verify email ownership before declining invitation (C1)"
```

---

### Task 2.2: Replace chat auto-accept with Better Auth API (M2 — Medium)

**Step 1: Replace direct DB insert with `auth.api.acceptInvitation`**

File: `src/routes/chat/+page.server.ts:48-64`

The `load` function signature needs `event` access. Change the function signature:

Replace:
```typescript
export const load: PageServerLoad = async ({ locals }) => {
```

With:
```typescript
export const load: PageServerLoad = async (event) => {
	const { locals } = event;
```

Then replace the pending invite block (lines 48-65):

Replace:
```typescript
if (pendingInvite) {
	// Accept the invitation: add user as member and mark invitation as accepted
	const memberId = generateId();
	const now = new Date();
	await db.insert(member).values({
		id: memberId,
		organizationId: pendingInvite.organizationId,
		userId: locals.user.id,
		role: pendingInvite.role || 'member',
		createdAt: now
	});
	await db
		.update(invitation)
		.set({ status: 'accepted' })
		.where(eq(invitation.id, pendingInvite.id));

	roomId = pendingInvite.organizationId;
	userRole = pendingInvite.role || 'member';
}
```

With:
```typescript
if (pendingInvite) {
	// Use Better Auth API to accept — ensures hooks and validation run
	try {
		await locals.auth!.api.acceptInvitation({
			body: { invitationId: pendingInvite.id },
			headers: event.request.headers
		});
	} catch (e) {
		console.error('[Chat] Auto-accept invitation failed:', e);
	}

	roomId = pendingInvite.organizationId;
	userRole = pendingInvite.role || 'member';
}
```

Also remove the now-unused `generateId` import if no other code uses it in this file. Check line 2: `import { generateId } from 'better-auth';` — grep the file for other `generateId` calls. The auto-create room block (line 68) still uses it, so keep the import.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/chat/+page.server.ts
git commit -m "fix(security): use Better Auth API for auto-accept instead of raw INSERT (M2)"
```

---

### Task 2.3: Filter invitation list by inviter (L4 — Low)

**Step 1: Add `inviterId` to the invitation query and filter by role**

File: `src/routes/chat/+page.server.ts:186-202`

Add `inviterId: invitation.inviterId` to the select. Then filter: owners see all invitations, leads see only their own.

In the select (around line 188), add:
```typescript
inviterId: invitation.inviterId,
```

In the return data mapping (around line 219), add:
```typescript
inviterId: inv.inviterId,
```

Then filter before returning:
```typescript
const filteredInvitations = roomInvitations
	.filter((inv: typeof roomInvitations[number]) =>
		userRole === 'owner' || inv.inviterId === locals.user.id
	)
	.map(/* existing map */);
```

Replace `roomInvitations: roomInvitations.map(...)` with `roomInvitations: filteredInvitations` in the return.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/chat/+page.server.ts
git commit -m "fix(privacy): filter invitation list — owners see all, leads see own (L4)"
```

---

## Batch 3: Hooks & Rate Limiting

**Files:**
- Modify: `src/hooks.server.ts:197-348`
- Modify: `src/routes/login/+page.svelte:59-104,181-204`
- Modify: `src/routes/api/reports/+server.ts:48-58`
- Modify: `src/routes/api/auth/magic/+server.ts:37-84`

### Task 3.1: Fix resend OTP Turnstile bypass (H1 — High)

**Step 1: Forward Turnstile token in resend call**

File: `src/routes/login/+page.svelte:181-204`

Replace:
```typescript
async function handleResendCode() {
	if (resending) return;
	resending = true;
	error = '';
	resendSuccess = false;
	try {
		const result = await emailOtp.sendVerificationOtp({
			email: email.trim(),
			type: 'sign-in'
		});
		if (result.error) {
			error = result.error.message || m.login_otp_send_failed();
		} else {
			code = '';
			resendSuccess = true;
			await tick();
			document.getElementById('code-input')?.focus();
		}
	} catch {
		error = m.error_generic();
	} finally {
		resending = false;
	}
}
```

With:
```typescript
async function handleResendCode() {
	if (resending) return;
	// Require fresh Turnstile token if configured
	if (turnstileSiteKey && !turnstileToken) return;
	resending = true;
	error = '';
	resendSuccess = false;
	try {
		const fetchHeaders: Record<string, string> = {};
		if (turnstileToken) {
			fetchHeaders['x-captcha-response'] = turnstileToken;
		}
		const result = await emailOtp.sendVerificationOtp({
			email: email.trim(),
			type: 'sign-in',
			fetchOptions: { headers: fetchHeaders }
		});
		if (result.error) {
			resetTurnstile();
			error = result.error.message || m.login_otp_send_failed();
		} else {
			resetTurnstile();
			code = '';
			resendSuccess = true;
			await tick();
			document.getElementById('code-input')?.focus();
		}
	} catch {
		resetTurnstile();
		error = m.error_generic();
	} finally {
		resending = false;
	}
}
```

**Step 2: Ensure Turnstile widget renders in the code step**

In the template section of `login/+page.svelte`, find the code step (the `{:else}` block that shows the OTP input). Add the Turnstile widget container before the resend button:

```svelte
{#if turnstileSiteKey}
	<div use:renderTurnstile class="mt-4 flex justify-center"></div>
{/if}
```

This reuses the existing `renderTurnstile` action. The widget will render fresh when entering the code step.

**Step 3: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "fix(security): require Turnstile token for OTP resend (H1)"
```

---

### Task 3.2: Add membership check to reports endpoint (H2 — High)

**Step 1: Add membership verification after org resolution**

File: `src/routes/api/reports/+server.ts:48-58`

Add `and` to the import from drizzle-orm at line 12:

```typescript
import { eq, and } from 'drizzle-orm';
```

Replace:
```typescript
// Resolve orgId from session or first membership
let orgId = locals.session.activeOrganizationId;
if (!orgId) {
	const [firstMembership] = await locals.db
		.select({ orgId: member.organizationId })
		.from(member)
		.where(eq(member.userId, locals.user.id))
		.limit(1);
	if (!firstMembership) error(400, 'No active organization');
	orgId = firstMembership.orgId;
}
```

With:
```typescript
// Resolve orgId from session or first membership
let orgId = locals.session.activeOrganizationId;
if (!orgId) {
	const [firstMembership] = await locals.db
		.select({ orgId: member.organizationId })
		.from(member)
		.where(eq(member.userId, locals.user.id))
		.limit(1);
	if (!firstMembership) error(400, 'No active organization');
	orgId = firstMembership.orgId;
} else {
	// Verify user is still a member of the claimed org
	const [membership] = await locals.db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!membership) error(403, 'Not a member of this room');
}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/api/reports/+server.ts
git commit -m "fix(security): verify membership before accepting content report (H2)"
```

---

### Task 3.3: Add rate limit to magic link POST (M3 — Medium)

**Step 1: Add IP-based rate limit at the start of the POST handler**

File: `src/routes/api/auth/magic/+server.ts:37-43`

After line 39 (`if (!kv) return json(...)`) and before line 41 (`const body = ...`), add:

```typescript
// Rate limit magic token consumption by IP — prevents token brute-force
const ip = getClientAddress();
const existing = await kv.get(`rl:magic-ip:${ip}`);
const count = existing ? parseInt(existing, 10) : 0;
if (count >= 10) {
	return json({ error: 'Too many attempts' }, { status: 429 });
}
await kv.put(`rl:magic-ip:${String(count + 1)}`, String(count + 1), { expirationTtl: 900 });
```

Wait — need to fix the KV key. Use proper key:

```typescript
const ipKey = `rl:magic-ip:${ip}`;
const existing = await kv.get(ipKey);
const count = existing ? parseInt(existing, 10) : 0;
if (count >= 10) {
	return json({ error: 'Too many attempts' }, { status: 429 });
}
await kv.put(ipKey, String(count + 1), { expirationTtl: 900 });
```

Also add `getClientAddress` to the destructured params of the POST handler:

```typescript
export const POST: RequestHandler = async ({ request, platform, fetch, getClientAddress }) => {
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/api/auth/magic/+server.ts
git commit -m "fix(security): add IP rate limit to magic link POST endpoint (M3)"
```

---

### Task 3.4: Add invitation rate limit (M6 — Medium)

**Step 1: Add rate limiting for the invite endpoint in hooks**

File: `src/hooks.server.ts` — add after the `isOtpVerify` declaration (around line 202):

```typescript
const isInvite =
	event.url.pathname === '/api/auth/organization/invite-member' &&
	event.request.method === 'POST';
```

Then inside the `if (kv)` block (or after the existing OTP rate limit block), before `resolve(event)`, add:

```typescript
if (isInvite && kv && event.locals.user) {
	const userId = event.locals.user.id;

	// Per-user invite limit: 20 invitations per hour
	const inviteLimit = await checkRateLimit(kv, {
		key: `invite-user:${userId}`,
		maxRequests: 20,
		windowSeconds: 3600
	});
	if (!inviteLimit.allowed) {
		return new Response(
			JSON.stringify({ error: { message: 'Too many invitations. Try again later.' } }),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "fix(security): add per-user rate limit for invitation sending (M6)"
```

---

## Batch 4: Chat Room & Username

**Files:**
- Modify: `src/lib/server/chat-room.ts:864-909`
- Modify: `src/routes/api/account/username/+server.ts:16-27`

### Task 4.1: Restrict `/whois` and remove user ID exposure (M5 — Medium)

**Step 1: Add role check and remove user ID from response**

File: `src/lib/server/chat-room.ts:864-909`

Replace:
```typescript
case 'whois': {
	const target = args.trim();
	if (!target) {
		this.sendError(ws, 'invalid_message', 'Usage: /whois <name>');
		return;
	}
	// Find online user matching the name
	const sockets = this.ctx.getWebSockets();
	let found = false;
	for (const s of sockets) {
		const sTags = this.ctx.getTags(s);
		const sName = this.extractTag(sTags, 'name:');
		if (sName.toLowerCase() === target.toLowerCase()) {
			const sRole = this.extractTag(sTags, 'role:');
			const sId = this.extractTag(sTags, 'user:');
			this.safeSend(ws, {
				type: 'message',
				message: {
					localId: `sys-${Date.now()}`,
					serverSeqId: 0,
					senderId: 'system',
					senderRole: 'system',
					senderName: 'System',
					body: `${sName} — role: ${sRole}, id: ${sId}`,
					timestamp: new Date().toISOString()
				}
			});
			found = true;
			break;
		}
	}
```

With:
```typescript
case 'whois': {
	// Restrict to owner/lead — members don't need to resolve user details
	if (role !== 'owner' && role !== 'lead') {
		this.sendError(ws, 'unauthorized', 'Only owner or lead can use /whois');
		return;
	}
	const target = args.trim();
	if (!target) {
		this.sendError(ws, 'invalid_message', 'Usage: /whois <name>');
		return;
	}
	// Find online user matching the name
	const sockets = this.ctx.getWebSockets();
	let found = false;
	for (const s of sockets) {
		const sTags = this.ctx.getTags(s);
		const sName = this.extractTag(sTags, 'name:');
		if (sName.toLowerCase() === target.toLowerCase()) {
			const sRole = this.extractTag(sTags, 'role:');
			this.safeSend(ws, {
				type: 'message',
				message: {
					localId: `sys-${Date.now()}`,
					serverSeqId: 0,
					senderId: 'system',
					senderRole: 'system',
					senderName: 'System',
					body: `${sName} — role: ${sRole}`,
					timestamp: new Date().toISOString()
				}
			});
			found = true;
			break;
		}
	}
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "fix(security): restrict /whois to owner/lead and remove user ID exposure (M5)"
```

---

### Task 4.2: Expand reserved usernames (L5 — Low)

**Step 1: Add missing reserved words**

File: `src/routes/api/account/username/+server.ts:16-27`

Replace:
```typescript
const RESERVED_WORDS = new Set([
	'admin',
	'system',
	'agent',
	'bot',
	'martol',
	'support',
	'help',
	'null',
	'undefined',
	'deleted'
]);
```

With:
```typescript
const RESERVED_WORDS = new Set([
	'admin',
	'system',
	'agent',
	'bot',
	'martol',
	'support',
	'help',
	'null',
	'undefined',
	'deleted',
	'sales',
	'moderator',
	'mod',
	'root',
	'security',
	'abuse',
	'postmaster',
	'info',
	'noreply',
	'api',
	'www',
	'staff',
	'team',
	'official'
]);
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/api/account/username/+server.ts
git commit -m "fix(security): expand reserved username list (L5)"
```

---

## Batch 5: Design Gaps

**Files:**
- Modify: `src/routes/login/+page.svelte`
- Create: `src/routes/api/account/age-verify/+server.ts`
- Modify: `src/hooks.server.ts`
- Modify: `src/routes/api/upload/+server.ts`
- Modify: `src/routes/chat/+page.server.ts`
- Modify: `worker-entry.ts`
- Modify: `src/lib/server/db/schema.ts` (if accountAudit table missing)

### Task 5.1: Server-side age verification (D1 — age gate + D8 — ageVerifiedAt)

**Step 1: Create age verification endpoint**

File: `src/routes/api/account/age-verify/+server.ts` (new)

```typescript
/**
 * POST /api/account/age-verify — Record server-side age verification
 *
 * Auth: session-based. Called once after first OTP verification.
 * Body: { year: number, month: number, day: number }
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';

const MIN_AGE = 16;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	// Already verified — skip
	if (locals.user.ageVerifiedAt) return json({ ok: true });

	const body = await request.json().catch(() => ({})) as Record<string, unknown>;
	const year = typeof body.year === 'number' ? body.year : 0;
	const month = typeof body.month === 'number' ? body.month : 0;
	const day = typeof body.day === 'number' ? body.day : 0;

	if (!year || !month || !day || year < 1900 || year > new Date().getFullYear()) {
		error(400, 'Invalid date of birth');
	}

	// Server-side age calculation
	const today = new Date();
	const birthDate = new Date(year, month - 1, day);
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
		age--;
	}

	if (age < MIN_AGE) {
		error(403, 'Age requirement not met');
	}

	// Store ageVerifiedAt — DOB is never stored
	await locals.db
		.update(user)
		.set({ ageVerifiedAt: new Date() })
		.where(eq(user.id, locals.user.id));

	return json({ ok: true });
};
```

**Step 2: Call the endpoint after OTP verification succeeds**

File: `src/routes/login/+page.svelte` — in `handleVerifyCode()`, after the successful `signIn.emailOtp()` call and before the `goto()`, add:

```typescript
// Record server-side age verification (DOB not stored, only timestamp)
if (dobYear && dobMonth && dobDay) {
	await fetch('/api/account/age-verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			year: parseInt(dobYear),
			month: parseInt(dobMonth),
			day: parseInt(dobDay)
		})
	}).catch(() => {});
}
```

**Step 3: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/routes/api/account/age-verify/+server.ts src/routes/login/+page.svelte
git commit -m "feat(security): add server-side age verification endpoint (D1/D8)"
```

---

### Task 5.2: Magic byte validation for uploads (D2)

**Step 1: Add magic byte validation function**

File: `src/routes/api/upload/+server.ts` — add before the POST handler:

```typescript
const MAGIC_BYTES: Record<string, number[][]> = {
	'image/jpeg': [[0xFF, 0xD8, 0xFF]],
	'image/png': [[0x89, 0x50, 0x4E, 0x47]],
	'image/gif': [[0x47, 0x49, 0x46, 0x38]],
	'image/webp': [[0x52, 0x49, 0x46, 0x46]],
	'application/pdf': [[0x25, 0x50, 0x44, 0x46]]
};

function validateMagicBytes(buffer: ArrayBuffer, claimedType: string): boolean {
	const sigs = MAGIC_BYTES[claimedType];
	if (!sigs) return true; // text/plain — no reliable magic bytes
	const bytes = new Uint8Array(buffer);
	return sigs.some((sig) => sig.every((byte, i) => bytes[i] === byte));
}
```

**Step 2: Add the check after the existing `file.type` check**

After the line `if (!ALLOWED_TYPES.has(file.type)) error(415, 'File type not allowed');`, add:

```typescript
const buffer = await file.arrayBuffer();
if (!validateMagicBytes(buffer, file.type)) {
	error(415, 'File content does not match declared type');
}
```

Remove or adjust the later `file.arrayBuffer()` call if it duplicates the read (the buffer is already in scope).

**Step 3: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/routes/api/upload/+server.ts
git commit -m "feat(security): add magic byte validation for file uploads (D2)"
```

---

### Task 5.3: Advisory lock for room auto-creation (D3)

**Step 1: Wrap auto-creation in a PostgreSQL advisory lock**

File: `src/routes/chat/+page.server.ts` — around the auto-creation block (after the pending invite check, in the `else` branch that creates a new org), add:

```typescript
import { sql } from 'drizzle-orm';
```

(This import likely already exists.) Before the `db.insert(organization)` call, add:

```typescript
// Advisory lock prevents duplicate room creation from concurrent requests
await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${locals.user.id}))`);

// Re-check membership after acquiring lock (another request may have created the room)
const [recheck] = await db
	.select({ orgId: member.organizationId })
	.from(member)
	.where(eq(member.userId, locals.user.id))
	.limit(1);
if (recheck) {
	roomId = recheck.orgId;
} else {
	// Proceed with original auto-creation logic
	const orgId = generateId();
	// ... rest of existing code
}
```

Note: `pg_advisory_xact_lock` requires a transaction context. Drizzle's default behavior may need wrapping in `db.transaction()`. If so:

```typescript
await db.transaction(async (tx) => {
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${locals.user.id}))`);
	const [recheck] = await tx
		.select({ orgId: member.organizationId })
		.from(member)
		.where(eq(member.userId, locals.user.id))
		.limit(1);
	if (recheck) {
		roomId = recheck.orgId;
	} else {
		// Auto-create using tx
	}
});
```

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/routes/chat/+page.server.ts
git commit -m "fix(security): advisory lock to prevent duplicate room auto-creation (D3)"
```

---

### Task 5.4: 2FA enforcement for room owners (D6 — enforcement only, UI deferred)

**Step 1: Add 2FA redirect check in hooks for owner-role users**

File: `src/hooks.server.ts` — add after the terms re-acceptance check (around line 192):

```typescript
// ── 2FA enforcement for room owners ──
// If user is an owner of the active org and hasn't enabled 2FA, redirect to setup
if (
	locals.user &&
	locals.session?.activeOrganizationId &&
	!event.url.pathname.startsWith('/api/') &&
	!event.url.pathname.startsWith('/accept-') &&
	event.url.pathname !== '/login' &&
	event.url.pathname !== '/settings' &&
	!locals.user.twoFactorEnabled
) {
	try {
		const [ownerCheck] = await locals.db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, locals.session.activeOrganizationId),
					eq(member.userId, locals.user.id),
					eq(member.role, 'owner')
				)
			)
			.limit(1);

		if (ownerCheck) {
			// Owner without 2FA — redirect to settings (where 2FA setup will live)
			if (event.url.pathname !== '/settings') {
				redirect(302, '/settings?setup2fa=1');
			}
		}
	} catch {
		// Fail open — don't block the user
	}
}
```

Note: This is enforcement-only. The actual 2FA setup UI in `/settings` is deferred to a separate task.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(security): redirect owners without 2FA to settings page (D6)"
```

---

### Task 5.5: Wire account audit logging hooks (D7)

**Step 1: Add audit logging after OTP verify in hooks**

File: `src/hooks.server.ts` — after the `resolve(event)` call, add audit logging for OTP verify results:

The current hooks structure calls `resolve(event)` and then applies CORS headers. Between `resolve` and the header setting, add:

```typescript
// ── Audit logging for OTP verify ──
if (isOtpVerify && locals.user && locals.db) {
	const action = response.ok ? 'login_success' : 'login_failed';
	try {
		const { accountAudit } = await import('$lib/server/db/schema');
		await locals.db.insert(accountAudit).values({
			userId: locals.user.id,
			action,
			ipAddress: event.getClientAddress(),
			userAgent: event.request.headers.get('user-agent') || null
		});
	} catch {
		// Non-critical — don't block the response
	}
}
```

Note: Check if `accountAudit` table exists in `src/lib/server/db/schema.ts`. If not, it needs to be created first. Per the exploration, it does exist at lines 258-287.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(security): wire account audit logging for login events (D7)"
```

---

### Task 5.6: Add invitation purge to cron handler (D9)

**Step 1: Add invitation cleanup to the scheduled handler**

File: `worker-entry.ts:65-85` — after the pending actions expiry block, before `finally`:

```typescript
// Purge expired pending invitations
try {
	const { invitation } = await import('./src/lib/server/db/auth-schema');
	const expired_invites = await db
		.update(invitation)
		.set({ status: 'canceled' })
		.where(
			and(
				eq(invitation.status, 'pending'),
				lt(invitation.expiresAt, new Date())
			)
		)
		.returning({ id: invitation.id });

	if (expired_invites.length > 0) {
		console.log(`[Cron] Expired ${expired_invites.length} pending invitations`);
	}
} catch (err) {
	console.error('[Cron] Invitation purge failed:', err);
}
```

Note: The `invitation` table uses `expiresAt` timestamp. The `eq` and `lt` imports are already available from line 60.

**Step 2: Run typecheck**

Run: `pnpm check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add worker-entry.ts
git commit -m "feat(security): add expired invitation purge to cron handler (D9)"
```

---

## Final: Update docs and changelog

### Task 6.1: Update security audit status in docs

**Step 1: Update `docs/004-SignIn-SignUp.md` §9**

Mark each fixed issue with a "Fixed" status and the commit reference.

**Step 2: Update `docs/plans/2026-03-03-security-remediation.md` changelog table**

Fill in batch statuses and commit hashes.

**Step 3: Run full check + deploy**

```bash
pnpm check && pnpm cf:deploy
```

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs: update security audit status after remediation"
```

---

## Summary: 18 tasks across 5 batches

| Batch | Tasks | Severity | Est. Time |
|-------|-------|----------|-----------|
| 1: Auth Server Core | 4 (C2, H3, H4, M4) | 1 crit, 2 high, 1 med | ~15 min |
| 2: Invitation Flow | 3 (C1, M2, L4) | 1 crit, 1 med, 1 low | ~15 min |
| 3: Hooks & Rate Limiting | 4 (H1, H2, M3, M6) | 2 high, 2 med | ~20 min |
| 4: Chat Room & Username | 2 (M5, L5) | 1 med, 1 low | ~5 min |
| 5: Design Gaps | 6 (D1, D2, D3, D6, D7, D9) | infrastructure | ~25 min |
| 6: Docs | 1 | docs | ~5 min |

**Batches 1-4 can run in parallel.** Batch 5 can also run in parallel but touches `hooks.server.ts` which is also in Batch 3 — schedule Batch 5 tasks D6/D7 after Batch 3 completes.

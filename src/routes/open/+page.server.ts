import { redirect, error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { user, member, organization, account, apikey, session as sessionTable } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
	const repo = url.searchParams.get('repo')?.trim() ?? '';

	if (!repo || !REPO_PATTERN.test(repo)) {
		return { error: 'invalid_repo' as const };
	}

	// Auth check — redirect to login with return URL
	if (!locals.user || !locals.session) {
		const returnUrl = `/open?repo=${encodeURIComponent(repo)}`;
		redirect(302, `/login?redirect=${encodeURIComponent(returnUrl)}`);
	}

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// [C4] Use -- separator to prevent slug collisions (foo/bar-baz vs foo-bar/baz)
	const [owner, name] = repo.split('/');
	const slug = `${owner.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

	// Check if user already has a room for this repo (by slug)
	const [existingOrg] = await db
		.select({ id: organization.id, name: organization.name })
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(and(eq(organization.slug, slug), eq(member.userId, locals.user.id)))
		.limit(1);

	if (existingOrg) {
		// Room already exists — set active and redirect to chat
		await db
			.update(sessionTable)
			.set({ activeOrganizationId: existingOrg.id })
			.where(eq(sessionTable.id, locals.session.id));
		redirect(302, '/chat');
	}

	// [C2] Removed: feature gate was checking wrong org (user's first org, not new org).
	// The new org starts with 1 agent; per-org limits are enforced by checkOrgLimits
	// when the org is used (chat, agent creation via /api/agents).

	// Create room (organization) named after repo — with advisory lock
	const orgId = generateId();
	const memberId = generateId();
	const agentUserId = crypto.randomUUID();
	const agentEmail = `agent-${crypto.randomUUID().slice(0, 12)}@agent.invalid`;
	const agentMemberId = crypto.randomUUID();
	const now = new Date();
	const agentName = `${repo} agent`;

	// [C1] Use sentinel to avoid redirect() inside transaction (throws SvelteKit exception,
	// leaves Hyperdrive connection broken). Also use two-arg advisory lock to avoid collisions.
	let existingRoomId: string | null = null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await db.transaction(async (tx: any) => {
		// [I4] Two-arg form gives 64-bit lock space, no concatenation collisions
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${locals.user.id})::int, hashtext(${repo})::int)`);

		// Re-check after lock
		const [recheck] = await tx
			.select({ id: organization.id })
			.from(organization)
			.innerJoin(member, eq(member.organizationId, organization.id))
			.where(and(eq(organization.slug, slug), eq(member.userId, locals.user.id)))
			.limit(1);

		if (recheck) {
			existingRoomId = recheck.id;
			return; // exit transaction cleanly — redirect after commit
		}

		// 1. Create organization (room)
		await tx.insert(organization).values({
			id: orgId,
			name: repo,
			slug,
			createdAt: now
		});

		// 2. Add user as owner
		await tx.insert(member).values({
			id: memberId,
			organizationId: orgId,
			userId: locals.user.id,
			role: 'owner',
			createdAt: now
		});

		// 3. Create synthetic agent user
		await tx.insert(user).values({
			id: agentUserId,
			name: agentName,
			email: agentEmail,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		// 4. Create account record for Better Auth consistency
		await tx.insert(account).values({
			id: crypto.randomUUID(),
			accountId: agentUserId,
			providerId: 'agent',
			userId: agentUserId,
			createdAt: now,
			updatedAt: now
		});

		// 5. Add agent as org member
		await tx.insert(member).values({
			id: agentMemberId,
			organizationId: orgId,
			userId: agentUserId,
			role: 'agent',
			createdAt: now
		});
	});

	// [C1] Handle redirect outside transaction
	if (existingRoomId) {
		await db
			.update(sessionTable)
			.set({ activeOrganizationId: existingRoomId })
			.where(eq(sessionTable.id, locals.session.id));
		redirect(302, '/chat');
	}

	// Create API key via Better Auth (outside transaction)
	let fullKey = '';
	try {
		const keyResult = await locals.auth.api.createApiKey({
			body: {
				name: `${agentName} key`,
				prefix: 'mtl',
				userId: agentUserId
			}
		});
		fullKey = (keyResult as any)?.key ?? '';
	} catch (e) {
		console.error('[Open] API key creation failed:', e);
		// [C5] Clean up on failure — delete apikey first (FK: apikey.referenceId → user.id)
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await db.transaction(async (tx: any) => {
				await tx.delete(apikey).where(eq(apikey.referenceId, agentUserId));
				await tx.delete(member).where(eq(member.organizationId, orgId));
				await tx.delete(account).where(eq(account.userId, agentUserId));
				await tx.delete(user).where(eq(user.id, agentUserId));
				await tx.delete(organization).where(eq(organization.id, orgId));
			});
		} catch (cleanupErr) {
			console.error('[Open] Cleanup failed:', cleanupErr);
		}
		error(500, 'Failed to create API key');
	}

	// [C6] Set active org AFTER successful API key creation (not before)
	await db
		.update(sessionTable)
		.set({ activeOrganizationId: orgId })
		.where(eq(sessionTable.id, locals.session.id));

	// [C7] Prevent caching of page containing plaintext API key
	setHeaders({ 'cache-control': 'no-store, private' });

	return {
		roomId: orgId,
		agentKey: fullKey,
		repo
	};
};

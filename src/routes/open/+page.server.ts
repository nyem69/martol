import { redirect, error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { user, member, organization, account, apikey, session as sessionTable } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const MAX_ROOMS_PER_USER = 20;

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

	// ── Idempotency guard: if user already owns a room for this repo, reuse it ──
	const [existing] = await db
		.select({ orgId: organization.id })
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(and(
			eq(organization.name, repo),
			eq(member.userId, locals.user.id),
			eq(member.role, 'owner')
		))
		.limit(1);

	if (existing) {
		// Switch to existing room and redirect to chat
		await db
			.update(sessionTable)
			.set({ activeOrganizationId: existing.orgId })
			.where(eq(sessionTable.id, locals.session.id));
		redirect(302, '/chat');
	}

	// ── Org count limit: prevent abuse ──
	const [{ count: ownedRooms }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(member)
		.where(and(eq(member.userId, locals.user.id), eq(member.role, 'owner')));

	if ((ownedRooms ?? 0) >= MAX_ROOMS_PER_USER) {
		error(403, `Room limit reached (max ${MAX_ROOMS_PER_USER}). Delete unused rooms first.`);
	}

	const [owner, name] = repo.split('/');
	const suffix = generateId().slice(0, 6);
	const slug = `${owner.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--${suffix}`;

	const orgId = generateId();
	const memberId = generateId();
	const agentUserId = crypto.randomUUID();
	const agentEmail = `agent-${crypto.randomUUID().slice(0, 12)}@agent.invalid`;
	const agentMemberId = crypto.randomUUID();
	const now = new Date();
	const agentName = `${repo} agent`;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await db.transaction(async (tx: any) => {
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
		// Clean up on failure — delete apikey first (FK: apikey.referenceId → user.id)
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

	// Set active org AFTER successful API key creation
	await db
		.update(sessionTable)
		.set({ activeOrganizationId: orgId })
		.where(eq(sessionTable.id, locals.session.id));

	// Prevent caching of page containing plaintext API key
	setHeaders({ 'cache-control': 'no-store, private' });

	return {
		roomId: orgId,
		agentKey: fullKey,
		repo
	};
};

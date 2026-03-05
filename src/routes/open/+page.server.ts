import { redirect, error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { user, member, organization, account, session as sessionTable } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkOrgLimits } from '$lib/server/feature-gates';
import type { PageServerLoad } from './$types';

const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export const load: PageServerLoad = async ({ url, locals }) => {
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

	// Check if user already has a room for this repo (by slug)
	const slug = repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');

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

	// Feature gate: check org limits before creating
	// Find user's first org to check limits (or use a lightweight check)
	const [firstMembership] = await db
		.select({ orgId: member.organizationId })
		.from(member)
		.where(eq(member.userId, locals.user.id))
		.limit(1);

	if (firstMembership) {
		const orgLimits = await checkOrgLimits(db, firstMembership.orgId);
		if (orgLimits.usage.agents >= orgLimits.limits.maxAgents) {
			error(403, `Agent limit reached (${orgLimits.limits.maxAgents}). Upgrade to add more.`);
		}
	}

	// Create room (organization) named after repo — with advisory lock
	const orgId = generateId();
	const memberId = generateId();
	const agentUserId = crypto.randomUUID();
	const agentEmail = `agent-${crypto.randomUUID().slice(0, 12)}@agent.invalid`;
	const agentMemberId = crypto.randomUUID();
	const now = new Date();
	const agentName = `${repo} agent`;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await db.transaction(async (tx: any) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${locals.user.id + repo}))`);

		// Re-check after lock
		const [recheck] = await tx
			.select({ id: organization.id })
			.from(organization)
			.innerJoin(member, eq(member.organizationId, organization.id))
			.where(and(eq(organization.slug, slug), eq(member.userId, locals.user.id)))
			.limit(1);

		if (recheck) {
			// Race condition — room was created between check and lock
			await db
				.update(sessionTable)
				.set({ activeOrganizationId: recheck.id })
				.where(eq(sessionTable.id, locals.session.id));
			redirect(302, '/chat');
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

	// Set active org to the new room
	await db
		.update(sessionTable)
		.set({ activeOrganizationId: orgId })
		.where(eq(sessionTable.id, locals.session.id));

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
		// Clean up on failure
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await db.transaction(async (tx: any) => {
				await tx.delete(member).where(eq(member.organizationId, orgId));
				await tx.delete(organization).where(eq(organization.id, orgId));
				await tx.delete(account).where(eq(account.userId, agentUserId));
				await tx.delete(user).where(eq(user.id, agentUserId));
			});
		} catch (cleanupErr) {
			console.error('[Open] Cleanup failed:', cleanupErr);
		}
		error(500, 'Failed to create API key');
	}

	return {
		roomId: orgId,
		agentKey: fullKey,
		repo
	};
};

import { redirect, error } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const activeOrgId = locals.session.activeOrganizationId;

	if (activeOrgId) {
		return {
			roomId: activeOrgId,
			userId: locals.user.id,
			userName: locals.user.name || locals.user.email || 'Unknown'
		};
	}

	// Fallback: get first org membership
	const [firstMembership] = await db
		.select({ orgId: member.organizationId })
		.from(member)
		.where(eq(member.userId, locals.user.id))
		.limit(1);

	if (!firstMembership) error(404, 'No organization found');

	return {
		roomId: firstMembership.orgId,
		userId: locals.user.id,
		userName: locals.user.name || locals.user.email || 'Unknown'
	};
};

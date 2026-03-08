import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkOrgLimits } from '$lib/server/feature-gates';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = locals.session.activeOrganizationId;
	if (!orgId) error(400, 'No active organization');

	const orgLimits = await checkOrgLimits(locals.db, orgId);

	return json({
		canUpload: orgLimits.limits.uploadsEnabled,
		plan: orgLimits.plan,
		storageUsed: orgLimits.usage.storageBytes,
		storageLimit: orgLimits.limits.maxStorageBytes,
	});
};

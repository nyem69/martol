import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachments, subscriptions } from '$lib/server/db/schema';
import { eq, count } from 'drizzle-orm';
import { FREE_UPLOAD_LIMIT } from '$lib/server/config';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const userId = locals.user.id;
	const db = locals.db;

	// Check subscription
	const [sub] = await db
		.select({
			plan: subscriptions.plan,
			status: subscriptions.status,
			currentPeriodEnd: subscriptions.currentPeriodEnd
		})
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	const isSubscribed =
		sub?.plan === 'image_upload' &&
		sub.status === 'active' &&
		(!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());

	const wasCanceled =
		sub?.plan === 'image_upload' && (sub.status === 'canceled' || sub.status === 'past_due');

	// Count uploads by this user
	const [result] = await db
		.select({ total: count() })
		.from(attachments)
		.where(eq(attachments.uploadedBy, userId));

	const used = result?.total ?? 0;
	const canUpload = isSubscribed || used < FREE_UPLOAD_LIMIT;

	return json({
		used,
		limit: isSubscribed ? -1 : FREE_UPLOAD_LIMIT,
		canUpload,
		plan: isSubscribed ? 'image_upload' : 'free',
		canceled: wasCanceled
	});
};

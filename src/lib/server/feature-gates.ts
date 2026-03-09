/**
 * Feature Gates — centralized plan limit checks
 *
 * Returns plan, limits, and current usage for an org.
 * Free: 5 users, 10 agents, 1000 msgs/day, no uploads
 * Pro: unlimited (high caps)
 */

import { subscriptions, messages, attachments } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and, gte, sql } from 'drizzle-orm';

interface PlanLimits {
	maxUsers: number;
	maxAgents: number;
	maxMsgsPerDay: number;
	maxStorageBytes: number;
	maxUploads: number;
	uploadsEnabled: boolean;
}

const FREE_LIMITS: PlanLimits = {
	maxUsers: 5,
	maxAgents: 10,
	maxMsgsPerDay: 1000,
	maxStorageBytes: 100 * 1024 * 1024, // 100 MB
	maxUploads: 10,
	uploadsEnabled: true
};

const PRO_LIMITS: PlanLimits = {
	maxUsers: 999,
	maxAgents: 999,
	maxMsgsPerDay: 999999,
	maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
	maxUploads: 999999,
	uploadsEnabled: true
};

export interface OrgLimitsResult {
	plan: 'free' | 'pro';
	status: 'active' | 'past_due' | 'canceled' | 'incomplete';
	limits: PlanLimits;
	usage: { users: number; agents: number; msgsToday: number; storageBytes: number; uploads: number };
	foundingMember: boolean;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	quantity: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkOrgLimits(db: any, orgId: string): Promise<OrgLimitsResult> {
	// 1. Load subscription (default: free)
	const [sub] = await db
		.select({
			plan: subscriptions.plan,
			status: subscriptions.status,
			foundingMember: subscriptions.foundingMember,
			currentPeriodEnd: subscriptions.currentPeriodEnd,
			cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
			quantity: subscriptions.quantity
		})
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	const plan: 'free' | 'pro' =
		sub?.plan === 'pro' && sub?.status === 'active' ? 'pro' : 'free';
	const limits = plan === 'pro' ? PRO_LIMITS : FREE_LIMITS;

	// 2. Count members
	const [{ count: users }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(member)
		.where(eq(member.organizationId, orgId));

	// 3. Count agents (from member table where role = 'agent')
	const [{ count: agents }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.role, 'agent')));

	// 4. Count today's messages
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	const [msgCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(and(eq(messages.orgId, orgId), gte(messages.createdAt, todayStart)));

	// 5. Sum storage bytes and count uploads
	const [storageResult] = await db
		.select({
			total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
			count: sql<number>`count(*)::int`,
		})
		.from(attachments)
		.where(eq(attachments.orgId, orgId));

	return {
		plan,
		status: sub?.status ?? 'active',
		limits,
		usage: {
			users: users ?? 0,
			agents: agents ?? 0,
			msgsToday: msgCount?.count ?? 0,
			storageBytes: Number(storageResult?.total ?? 0),
			uploads: storageResult?.count ?? 0
		},
		foundingMember: sub?.foundingMember === true,
		currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
		cancelAtPeriodEnd: sub?.cancelAtPeriodEnd === true,
		quantity: sub?.quantity ?? 0
	};
}

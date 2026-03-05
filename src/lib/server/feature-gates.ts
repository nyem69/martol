/**
 * Feature Gates — centralized plan limit checks
 *
 * Returns plan, limits, and current usage for an org.
 * Free: 3 users, 2 agents, 50 msgs/day, no uploads
 * Pro: unlimited (high caps)
 */

import { subscriptions, messages, agentRoomBindings } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and, gte, sql } from 'drizzle-orm';

interface PlanLimits {
	maxUsers: number;
	maxAgents: number;
	maxMsgsPerDay: number;
	uploadsEnabled: boolean;
}

const FREE_LIMITS: PlanLimits = {
	maxUsers: 3,
	maxAgents: 2,
	maxMsgsPerDay: 50,
	uploadsEnabled: false
};

const PRO_LIMITS: PlanLimits = {
	maxUsers: 999,
	maxAgents: 999,
	maxMsgsPerDay: 999999,
	uploadsEnabled: true
};

export interface OrgLimitsResult {
	plan: 'free' | 'pro';
	status: 'active' | 'past_due' | 'canceled' | 'incomplete';
	limits: PlanLimits;
	usage: { users: number; agents: number; msgsToday: number };
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
	const memberRows = await db
		.select({ id: member.id })
		.from(member)
		.where(eq(member.organizationId, orgId));
	const users = memberRows.length;

	// 3. Count agents
	const agentRows = await db
		.select({ id: agentRoomBindings.id })
		.from(agentRoomBindings)
		.where(eq(agentRoomBindings.orgId, orgId));
	const agents = agentRows.length;

	// 4. Count today's messages
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	const [msgCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(and(eq(messages.orgId, orgId), gte(messages.createdAt, todayStart)));

	return {
		plan,
		status: sub?.status ?? 'active',
		limits,
		usage: {
			users,
			agents,
			msgsToday: msgCount?.count ?? 0
		},
		foundingMember: sub?.foundingMember === true,
		currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
		cancelAtPeriodEnd: sub?.cancelAtPeriodEnd === true,
		quantity: sub?.quantity ?? 0
	};
}

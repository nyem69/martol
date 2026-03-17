/**
 * RAG System User — creates a synthetic user for the Docs AI sender identity.
 * Ensures the messages.senderId FK constraint is satisfied during WAL flush.
 */

import { eq, and } from 'drizzle-orm';
import { user, member } from '$lib/server/db/auth-schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Ensure a RAG system user exists for the given org/room.
 * Creates the user and org membership if they don't already exist.
 * Uses onConflictDoNothing() for idempotency.
 *
 * @returns The RAG user ID (`rag-{orgId}`)
 */
export async function ensureRagUser(db: NodePgDatabase<any>, orgId: string): Promise<string> {
	const ragUserId = `rag-${orgId}`;

	// Check if user already exists
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, ragUserId))
		.limit(1);

	if (!existingUser) {
		const now = new Date();
		await db
			.insert(user)
			.values({
				id: ragUserId,
				name: 'Docs AI',
				email: `rag-${orgId}@system.martol.app`,
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
	}

	// Check if user is an org member
	const [existingMember] = await db
		.select({ userId: member.userId })
		.from(member)
		.where(and(eq(member.userId, ragUserId), eq(member.organizationId, orgId)))
		.limit(1);

	if (!existingMember) {
		await db
			.insert(member)
			.values({
				id: `mbr-rag-${orgId}`,
				userId: ragUserId,
				organizationId: orgId,
				role: 'member',
				createdAt: new Date(),
			})
			.onConflictDoNothing();
	}

	return ragUserId;
}

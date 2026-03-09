/**
 * Shared brief-fetch logic.
 *
 * Single source of truth for reading the active brief:
 *   1. KV cache (if available, 60s TTL)
 *   2. Query project_brief table (active row)
 *   3. Fall back to organization.metadata JSON
 *
 * Used by: REST API, brief_get_active MCP tool, chat_who MCP tool.
 */

import { eq, and } from 'drizzle-orm';
import { organization } from './auth-schema';
import { projectBrief } from './schema';

export interface ActiveBrief {
	content: string | null;
	version: number;
}

const KV_PREFIX = 'brief:';
const KV_TTL_SECONDS = 60;

export async function getActiveBrief(
	db: any,
	orgId: string,
	kv?: KVNamespace
): Promise<ActiveBrief> {
	// 1. Try KV cache
	if (kv) {
		try {
			const cached = await kv.get(`${KV_PREFIX}${orgId}`);
			if (cached) {
				return JSON.parse(cached) as ActiveBrief;
			}
		} catch { /* cache miss or parse error — fall through */ }
	}

	// 2. Try project_brief table (active row)
	const [activeBrief] = await db
		.select({ content: projectBrief.content, version: projectBrief.version })
		.from(projectBrief)
		.where(and(eq(projectBrief.orgId, orgId), eq(projectBrief.status, 'active')))
		.limit(1);

	if (activeBrief) {
		const result: ActiveBrief = { content: activeBrief.content, version: activeBrief.version };
		if (kv) {
			// Fire-and-forget cache write
			kv.put(`${KV_PREFIX}${orgId}`, JSON.stringify(result), { expirationTtl: KV_TTL_SECONDS }).catch(() => {});
		}
		return result;
	}

	// 3. Fallback: organization.metadata
	const [org] = await db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	if (org?.metadata) {
		try {
			const meta = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata;
			if (typeof meta?.brief === 'string' && meta.brief.length > 0) {
				return { content: meta.brief, version: 0 };
			}
		} catch { /* ignore invalid JSON */ }
	}

	return { content: null, version: 0 };
}

/**
 * Invalidate cached brief for an org.
 * Call after PUT to ensure subsequent reads get fresh data.
 */
export async function invalidateBriefCache(kv: KVNamespace | undefined, orgId: string): Promise<void> {
	if (!kv) return;
	try {
		await kv.delete(`${KV_PREFIX}${orgId}`);
	} catch { /* best-effort */ }
}

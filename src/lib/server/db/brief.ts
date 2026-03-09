/**
 * Shared brief-fetch logic.
 *
 * Single source of truth for reading the active brief:
 *   1. Query project_brief table (active row)
 *   2. Fall back to organization.metadata JSON
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

export async function getActiveBrief(db: any, orgId: string): Promise<ActiveBrief> {
	// Try project_brief table first (active row)
	const [activeBrief] = await db
		.select({ content: projectBrief.content, version: projectBrief.version })
		.from(projectBrief)
		.where(and(eq(projectBrief.orgId, orgId), eq(projectBrief.status, 'active')))
		.limit(1);

	if (activeBrief) {
		return { content: activeBrief.content, version: activeBrief.version };
	}

	// Fallback: organization.metadata
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

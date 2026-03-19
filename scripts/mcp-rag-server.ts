#!/usr/bin/env node
/**
 * MCP Server for RAG Document Search
 *
 * Provides direct access to document chunks and search results
 * for debugging and evaluation. Connects to PostgreSQL directly.
 *
 * Usage (add to Claude Code MCP config):
 *   {
 *     "mcpServers": {
 *       "martol-rag": {
 *         "command": "npx",
 *         "args": ["tsx", "scripts/mcp-rag-server.ts"],
 *         "env": { "DATABASE_URL": "postgres://..." }
 *       }
 *     }
 *   }
 *
 * Tools provided:
 *   - search_chunks: keyword search across document chunks
 *   - list_documents: list all indexed documents with chunk counts
 *   - get_chunks: get all chunks for a specific file
 *   - search_stats: show indexing statistics
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL || '';

let pool: pg.Pool;

function getPool(): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
	}
	return pool;
}

async function query(sql: string, params: any[] = []): Promise<any[]> {
	const client = await getPool().connect();
	try {
		const result = await client.query(sql, params);
		return result.rows;
	} finally {
		client.release();
	}
}

const server = new Server(
	{ name: 'martol-rag', version: '1.0.0' },
	{ capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: 'search_chunks',
			description: 'Keyword search across document chunks. Searches chunk content using SQL ILIKE. Returns matching chunks with filename, score simulation, and content preview.',
			inputSchema: {
				type: 'object' as const,
				properties: {
					query: { type: 'string', description: 'Search keyword or phrase' },
					org_id: { type: 'string', description: 'Organization/room ID (optional — searches all if omitted)' },
					limit: { type: 'number', description: 'Max results (default 10)' },
				},
				required: ['query'],
			},
		},
		{
			name: 'list_documents',
			description: 'List all indexed documents with chunk counts and processing status.',
			inputSchema: {
				type: 'object' as const,
				properties: {
					org_id: { type: 'string', description: 'Organization/room ID (optional)' },
					status: { type: 'string', description: 'Filter by processing_status (indexed, failed, pending, etc.)' },
				},
			},
		},
		{
			name: 'get_chunks',
			description: 'Get all chunks for a specific document file. Shows chunk content, metadata, and vector IDs.',
			inputSchema: {
				type: 'object' as const,
				properties: {
					filename: { type: 'string', description: 'Document filename (e.g., "198.pdf")' },
					org_id: { type: 'string', description: 'Organization/room ID (optional)' },
				},
				required: ['filename'],
			},
		},
		{
			name: 'search_stats',
			description: 'Show indexing statistics: total documents, chunks, by status, by embedding model.',
			inputSchema: {
				type: 'object' as const,
				properties: {
					org_id: { type: 'string', description: 'Organization/room ID (optional)' },
				},
			},
		},
		{
			name: 'reprocess_document',
			description: 'Reset a document for re-processing. Deletes existing chunks and resets status to pending. The cron job will re-index it.',
			inputSchema: {
				type: 'object' as const,
				properties: {
					filename: { type: 'string', description: 'Document filename (e.g., "198.pdf")' },
					org_id: { type: 'string', description: 'Organization/room ID (required)' },
				},
				required: ['filename', 'org_id'],
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case 'search_chunks': {
				const q = args?.query as string;
				const orgId = args?.org_id as string | undefined;
				const limit = (args?.limit as number) || 10;

				const whereClause = orgId
					? `WHERE dc.content ILIKE $1 AND dc.org_id = $2`
					: `WHERE dc.content ILIKE $1`;
				const params = orgId ? [`%${q}%`, orgId] : [`%${q}%`];

				const rows = await query(
					`SELECT dc.chunk_index, dc.content, dc.vector_id, dc.document_title, dc.document_date, dc.language,
					        a.filename, a.processing_status, a.org_id,
					        LENGTH(dc.content) as content_len
					 FROM document_chunks dc
					 JOIN attachments a ON dc.attachment_id = a.id
					 ${whereClause}
					 ORDER BY a.filename, dc.chunk_index
					 LIMIT ${limit}`,
					params
				);

				return {
					content: [{
						type: 'text',
						text: JSON.stringify({
							query: q,
							results: rows.map(r => ({
								filename: r.filename,
								chunk_index: r.chunk_index,
								content_preview: r.content.slice(0, 300),
								content_len: r.content_len,
								document_title: r.document_title,
								document_date: r.document_date,
								language: r.language,
								vector_id: r.vector_id,
								org_id: r.org_id,
							})),
							total: rows.length,
						}, null, 2),
					}],
				};
			}

			case 'list_documents': {
				const orgId = args?.org_id as string | undefined;
				const status = args?.status as string | undefined;

				let whereClause = '';
				const params: string[] = [];
				if (orgId) { params.push(orgId); whereClause += ` WHERE a.org_id = $${params.length}`; }
				if (status) { params.push(status); whereClause += (whereClause ? ' AND' : ' WHERE') + ` a.processing_status = $${params.length}`; }

				const rows = await query(
					`SELECT a.id, a.filename, a.content_type, a.size_bytes, a.processing_status,
					        a.extraction_error_code, a.parser_name, a.extracted_text_bytes,
					        a.org_id,
					        COUNT(dc.id) as chunk_count
					 FROM attachments a
					 LEFT JOIN document_chunks dc ON dc.attachment_id = a.id
					 ${whereClause}
					 GROUP BY a.id
					 ORDER BY a.filename`,
					params
				);

				return {
					content: [{
						type: 'text',
						text: JSON.stringify({
							documents: rows.map(r => ({
								id: r.id,
								filename: r.filename,
								status: r.processing_status,
								error: r.extraction_error_code,
								parser: r.parser_name,
								size_bytes: r.size_bytes,
								extracted_text_bytes: r.extracted_text_bytes,
								chunks: parseInt(r.chunk_count),
								org_id: r.org_id,
							})),
							total: rows.length,
						}, null, 2),
					}],
				};
			}

			case 'get_chunks': {
				const filename = args?.filename as string;
				const orgId = args?.org_id as string | undefined;

				const whereClause = orgId
					? `WHERE a.filename = $1 AND a.org_id = $2`
					: `WHERE a.filename = $1`;
				const params = orgId ? [filename, orgId] : [filename];

				const rows = await query(
					`SELECT dc.chunk_index, dc.content, dc.vector_id, dc.token_count,
					        dc.char_start, dc.char_end, dc.embedding_model, dc.embedding_dim,
					        dc.document_title, dc.document_date, dc.language,
					        a.filename, a.org_id
					 FROM document_chunks dc
					 JOIN attachments a ON dc.attachment_id = a.id
					 ${whereClause}
					 ORDER BY dc.chunk_index`,
					params
				);

				return {
					content: [{
						type: 'text',
						text: JSON.stringify({
							filename,
							chunks: rows.map(r => ({
								chunk_index: r.chunk_index,
								content: r.content,
								content_len: r.content.length,
								vector_id: r.vector_id,
								token_count: r.token_count,
								char_start: r.char_start,
								char_end: r.char_end,
								embedding_model: r.embedding_model,
								document_title: r.document_title,
								document_date: r.document_date,
								language: r.language,
							})),
							total: rows.length,
						}, null, 2),
					}],
				};
			}

			case 'search_stats': {
				const orgId = args?.org_id as string | undefined;
				const orgFilter = orgId ? ` WHERE a.org_id = $1` : '';
				const params = orgId ? [orgId] : [];

				const [statusStats, modelStats, totalChunks] = await Promise.all([
					query(
						`SELECT a.processing_status, COUNT(*) as count
						 FROM attachments a ${orgFilter}
						 GROUP BY a.processing_status ORDER BY count DESC`,
						params
					),
					query(
						`SELECT dc.embedding_model, COUNT(*) as count
						 FROM document_chunks dc
						 ${orgId ? 'JOIN attachments a ON dc.attachment_id = a.id WHERE a.org_id = $1' : ''}
						 GROUP BY dc.embedding_model`,
						params
					),
					query(
						`SELECT COUNT(*) as total FROM document_chunks dc
						 ${orgId ? 'JOIN attachments a ON dc.attachment_id = a.id WHERE a.org_id = $1' : ''}`,
						params
					),
				]);

				return {
					content: [{
						type: 'text',
						text: JSON.stringify({
							total_chunks: parseInt(totalChunks[0]?.total ?? '0'),
							by_status: Object.fromEntries(statusStats.map(r => [r.processing_status, parseInt(r.count)])),
							by_embedding_model: Object.fromEntries(modelStats.map(r => [r.embedding_model, parseInt(r.count)])),
						}, null, 2),
					}],
				};
			}

			case 'reprocess_document': {
				const filename = args?.filename as string;
				const orgId = args?.org_id as string;

				// Get attachment ID
				const [att] = await query(
					`SELECT id FROM attachments WHERE filename = $1 AND org_id = $2`,
					[filename, orgId]
				);
				if (!att) {
					return { content: [{ type: 'text', text: `Document "${filename}" not found in org ${orgId}` }] };
				}

				// Delete chunks
				const deleted = await query(
					`DELETE FROM document_chunks WHERE attachment_id = $1 RETURNING vector_id`,
					[att.id]
				);

				// Reset status
				await query(
					`UPDATE attachments SET processing_status = 'pending', extraction_error_code = NULL WHERE id = $1`,
					[att.id]
				);

				// Delete old ingestion jobs
				await query(
					`DELETE FROM ingestion_jobs WHERE attachment_id = $1`,
					[att.id]
				);

				return {
					content: [{
						type: 'text',
						text: JSON.stringify({
							ok: true,
							filename,
							attachment_id: att.id,
							chunks_deleted: deleted.length,
							orphaned_vectors: deleted.map((r: any) => r.vector_id),
							message: 'Document reset to pending. Cron will re-process within 5 minutes.',
						}, null, 2),
					}],
				};
			}

			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: any) {
		return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
	}
});

async function main() {
	if (!DATABASE_URL) {
		console.error('DATABASE_URL is required');
		process.exit(1);
	}

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(console.error);

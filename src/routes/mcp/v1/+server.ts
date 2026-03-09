import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mcpRequestSchema } from '$lib/types/mcp';
import { authenticateAgent } from '$lib/server/mcp/auth';
import { chatSend } from '$lib/server/mcp/tools/chat-send';
import { chatRead, chatResync } from '$lib/server/mcp/tools/chat-read';
import { chatJoin } from '$lib/server/mcp/tools/chat-join';
import { chatWho } from '$lib/server/mcp/tools/chat-who';
import { actionSubmit } from '$lib/server/mcp/tools/action-submit';
import { actionStatus } from '$lib/server/mcp/tools/action-status';
import { actionConfirm } from '$lib/server/mcp/tools/action-confirm';
import { ticketList } from '$lib/server/mcp/tools/ticket-list';
import { ticketRead } from '$lib/server/mcp/tools/ticket-read';
import { ticketComment } from '$lib/server/mcp/tools/ticket-comment';
import { ticketUpdate } from '$lib/server/mcp/tools/ticket-update';
import { docSearch } from '$lib/server/mcp/tools/doc-search';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.auth || !locals.db) {
		error(503, 'Service unavailable');
	}

	// Guard against oversized payloads before parsing
	const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
	if (contentLength > 65536) {
		return json({ ok: false, error: 'Request too large', code: 'payload_too_large' }, { status: 413 });
	}

	const kv = platform?.env?.CACHE;
	const authResult = await authenticateAgent(request.headers.get('x-api-key'), locals.auth, locals.db, kv);

	if (!authResult.ok) {
		return json(authResult.error, { status: authResult.status });
	}

	const { agent } = authResult;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: 'Invalid JSON body', code: 'invalid_json' },
			{ status: 400 }
		);
	}

	const parsed = mcpRequestSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{
				ok: false,
				error: 'Invalid request',
				code: 'validation_error',
				details: parsed.error.issues.map((i) => i.message)
			},
			{ status: 400 }
		);
	}

	const req = parsed.data;

	try {
		let result;

		switch (req.tool) {
			case 'chat_send':
				result = await chatSend(req.params, agent, locals.db, platform ?? undefined);
				break;
			case 'chat_read':
				result = await chatRead(req.params, agent, locals.db);
				break;
			case 'chat_resync':
				result = await chatResync(req.params, agent, locals.db);
				break;
			case 'chat_join':
				result = await chatJoin(agent, locals.db);
				break;
			case 'chat_who':
				result = await chatWho(agent, locals.db);
				break;
			case 'action_submit':
				result = await actionSubmit(req.params, agent, locals.db);
				break;
			case 'action_status':
				result = await actionStatus(req.params, agent, locals.db);
				break;
			case 'action_confirm':
				result = await actionConfirm(req.params, agent, locals.db);
				break;
			case 'ticket_list':
				result = await ticketList(req.params, agent, locals.db);
				break;
			case 'ticket_read':
				result = await ticketRead(req.params, agent, locals.db);
				break;
			case 'ticket_comment':
				result = await ticketComment(req.params, agent, locals.db);
				break;
			case 'ticket_update':
				result = await ticketUpdate(req.params, agent, locals.db);
				break;
			case 'doc_search': {
				const env = platform?.env;
				if (!env?.VECTORIZE) {
					return json({ ok: false, error: 'Document search not configured', code: 'vectorize_unavailable' }, { status: 503 });
				}
				result = await docSearch(req.params, agent, locals.db, env.AI, env.VECTORIZE);
				break;
			}
			default: {
				const _exhaustive: never = req;
				return json(
					{ ok: false, error: `Unknown tool: ${(req as any).tool}`, code: 'unknown_tool' },
					{ status: 400 }
				);
			}
		}

		const status = result.ok ? 200 : (result as any).code === 'action_rejected' ? 403 : 400;
		return json(result, { status });
	} catch (err) {
		console.error('[MCP] Tool handler error:', err);
		return json({ ok: false, error: 'Internal error', code: 'internal' }, { status: 500 });
	}
};

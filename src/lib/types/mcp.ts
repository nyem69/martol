import { z } from 'zod';

// ── Tool request schemas ─────────────────────────────────────

export const chatSendSchema = z.object({
	tool: z.literal('chat_send'),
	params: z.object({
		body: z.string().min(1).max(32768),
		replyTo: z.number().int().positive().optional(),
	}),
});

export const chatReadSchema = z.object({
	tool: z.literal('chat_read'),
	params: z
		.object({
			limit: z.number().int().min(1).max(200).default(50),
		})
		.default({ limit: 50 }),
});

export const chatResyncSchema = z.object({
	tool: z.literal('chat_resync'),
	params: z
		.object({
			limit: z.number().int().min(1).max(200).default(50),
		})
		.default({ limit: 50 }),
});

export const chatJoinSchema = z.object({
	tool: z.literal('chat_join'),
	params: z.object({}).default({}),
});

export const chatWhoSchema = z.object({
	tool: z.literal('chat_who'),
	params: z.object({}).default({}),
});

export const actionSubmitSchema = z.object({
	tool: z.literal('action_submit'),
	params: z.object({
		action_type: z.enum([
			'question_answer',
			'code_review',
			'code_write',
			'code_modify',
			'code_delete',
			'deploy',
			'config_change',
		]),
		risk_level: z.enum(['low', 'medium', 'high']),
		trigger_message_id: z.number().int().positive(),
		description: z.string().min(1).max(2000),
		payload: z.record(z.string(), z.unknown()).optional(),
		simulation: z.object({
			type: z.enum(['code_diff', 'shell_preview', 'api_call', 'file_ops', 'custom']),
			preview: z.record(z.string(), z.unknown()),
			impact: z.object({
				files_modified: z.number().int().nonnegative().optional(),
				services_affected: z.array(z.string()).max(20).optional(),
				reversible: z.boolean().optional(),
			}).optional(),
			risk_factors: z.array(z.object({
				factor: z.string().max(100),
				severity: z.enum(['low', 'medium', 'high']),
				detail: z.string().max(500),
			})).max(10).optional(),
		}).optional(),
	}),
});

export const actionStatusSchema = z.object({
	tool: z.literal('action_status'),
	params: z.object({
		action_id: z.number().int().positive(),
	}),
});

export const actionConfirmSchema = z.object({
	tool: z.literal('action_confirm'),
	params: z.object({
		action_id: z.number().int().positive(),
	}),
});

export const ticketListSchema = z.object({
	tool: z.literal('ticket_list'),
	params: z
		.object({
			status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
			limit: z.number().int().min(1).max(100).default(20),
		})
		.default({ limit: 20 }),
});

export const ticketReadSchema = z.object({
	tool: z.literal('ticket_read'),
	params: z.object({
		ticket_id: z.string().min(1).max(64),
	}),
});

export const ticketCommentSchema = z.object({
	tool: z.literal('ticket_comment'),
	params: z.object({
		ticket_id: z.string().min(1).max(64),
		content: z.string().min(1).max(5000),
	}),
});

export const ticketUpdateSchema = z.object({
	tool: z.literal('ticket_update'),
	params: z.object({
		ticket_id: z.string().min(1).max(64),
		status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
		assigned_to: z.array(z.string()).optional(),
	}),
});

export const mcpRequestSchema = z.discriminatedUnion('tool', [
	chatSendSchema,
	chatReadSchema,
	chatResyncSchema,
	chatJoinSchema,
	chatWhoSchema,
	actionSubmitSchema,
	actionStatusSchema,
	actionConfirmSchema,
	ticketListSchema,
	ticketReadSchema,
	ticketCommentSchema,
	ticketUpdateSchema,
]);

export type McpRequest = z.infer<typeof mcpRequestSchema>;

// ── Response types ───────────────────────────────────────────

export interface McpSuccess<T = unknown> {
	ok: true;
	data: T;
}

export interface McpError {
	ok: false;
	error: string;
	code: string;
}

export type McpResponse<T = unknown> = McpSuccess<T> | McpError;

// ── Tool response data types ─────────────────────────────────

export interface ChatSendResult {
	message_id: number;
	timestamp: string;
}

export interface ChatMessage {
	id: number;
	sender_id: string;
	sender_name: string;
	sender_role: string;
	body: string;
	reply_to: number | null;
	timestamp: string;
}

export interface ChatReadResult {
	messages: ChatMessage[];
	cursor: number;
	has_more: boolean;
}

export interface ChatWhoMember {
	user_id: string;
	name: string;
	role: string;
	is_agent: boolean;
	ai_opt_out: boolean;
}

export interface ChatWhoResult {
	room_id: string;
	room_name: string;
	self_user_id: string;
	members: ChatWhoMember[];
}

export interface ActionSubmitResult {
	action_id: number;
	status: 'approved' | 'pending' | 'rejected';
	server_risk: string;
}

export interface ActionStatusResult {
	action_id: number;
	status: string;
	action_type: string;
	risk_level: string;
	description: string;
	created_at: string;
	approved_by: string | null;
	approved_at: string | null;
}

export interface TicketListItem {
	id: string;
	title: string;
	category: string;
	status: string;
	created_at: string;
}

export interface TicketDetail extends TicketListItem {
	description: string;
	user_id: string;
	assigned_to: string[] | null;
	resolved_at: string | null;
	closed_at: string | null;
	updated_at: string;
	comments: Array<{
		id: string;
		user_id: string | null;
		agent_user_id: string | null;
		content: string;
		created_at: string;
	}>;
}

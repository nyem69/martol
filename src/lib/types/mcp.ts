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
	}),
});

export const actionStatusSchema = z.object({
	tool: z.literal('action_status'),
	params: z.object({
		action_id: z.number().int().positive(),
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

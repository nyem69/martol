/**
 * Database Schema — Martol (PostgreSQL via Drizzle ORM)
 *
 * Better Auth manages: user, session, account, verification, organization, member, invitation
 * We define the application-specific tables here.
 */

import {
	pgTable,
	bigserial,
	text,
	timestamp,
	bigint,
	jsonb,
	uniqueIndex,
	index,
	primaryKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Messages — chat messages with server-derived sender identity
 * sender_role is denormalized deliberately: roles change, but the message records
 * what authority the sender had *when they wrote it*.
 */
export const messages = pgTable(
	'messages',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		senderId: text('sender_id').notNull(),
		senderRole: text('sender_role')
			.notNull()
			.$type<'owner' | 'lead' | 'member' | 'viewer' | 'agent'>(),
		type: text('type').notNull().default('chat').$type<'chat' | 'system' | 'join' | 'action'>(),
		body: text('body').notNull(),
		replyTo: bigint('reply_to', { mode: 'number' }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_messages_org_id').on(table.orgId, table.id),
		index('idx_messages_org_sender').on(table.orgId, table.senderId, table.id)
	]
);

/**
 * Attachments — files uploaded with messages, stored in R2
 */
export const attachments = pgTable('attachments', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	messageId: bigint('message_id', { mode: 'number' }).notNull(),
	orgId: text('org_id').notNull(),
	filename: text('filename').notNull(),
	r2Key: text('r2_key').notNull(),
	contentType: text('content_type'),
	sizeBytes: bigint('size_bytes', { mode: 'number' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Todos — pinned messages as actionable items
 */
export const todos = pgTable('todos', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	messageId: bigint('message_id', { mode: 'number' }).notNull(),
	orgId: text('org_id').notNull(),
	status: text('status').notNull().default('todo').$type<'todo' | 'done'>(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Agent Room Bindings — links agent synthetic users to rooms (organizations)
 * Replaces JSON metadata on API keys with proper FK integrity.
 */
export const agentRoomBindings = pgTable(
	'agent_room_bindings',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		agentUserId: text('agent_user_id').notNull(),
		label: text('label').notNull(),
		model: text('model').notNull(),
		color: text('color'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_agent_room_bindings_org_label').on(table.orgId, table.label),
		uniqueIndex('idx_agent_room_bindings_agent_user').on(table.agentUserId)
	]
);

/**
 * Agent Cursors — MCP cursor tracking for per-agent message reads
 */
export const agentCursors = pgTable(
	'agent_cursors',
	{
		orgId: text('org_id').notNull(),
		agentUserId: text('agent_user_id').notNull(),
		lastReadId: bigint('last_read_id', { mode: 'number' }).notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.orgId, table.agentUserId] })
	]
);

/**
 * Read Cursors — human read position tracking for unread counts
 */
export const readCursors = pgTable(
	'read_cursors',
	{
		orgId: text('org_id').notNull(),
		userId: text('user_id').notNull(),
		lastReadMessageId: bigint('last_read_message_id', { mode: 'number' }).notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.orgId, table.userId] })
	]
);

/**
 * Pending Actions — server-side action gating queue
 * Agents submit structured intents; server validates against role × risk matrix.
 */
export const pendingActions = pgTable(
	'pending_actions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		triggerMessageId: bigint('trigger_message_id', { mode: 'number' }).notNull(),
		requestedBy: text('requested_by').notNull(),
		requestedRole: text('requested_role').notNull(),
		agentUserId: text('agent_user_id').notNull(),
		actionType: text('action_type')
			.notNull()
			.$type<
				| 'question_answer'
				| 'code_review'
				| 'code_write'
				| 'code_modify'
				| 'code_delete'
				| 'deploy'
				| 'config_change'
			>(),
		riskLevel: text('risk_level').notNull().$type<'low' | 'medium' | 'high'>(),
		description: text('description').notNull(),
		payloadJson: jsonb('payload_json'),
		status: text('status')
			.notNull()
			.default('pending')
			.$type<'pending' | 'approved' | 'rejected' | 'expired' | 'executed'>(),
		approvedBy: text('approved_by'),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		executedAt: timestamp('executed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_pending_actions_org_status').on(table.orgId, table.status, table.createdAt)
	]
);

/**
 * Role Audit — append-only log of role changes for compliance
 */
export const roleAudit = pgTable(
	'role_audit',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		changedBy: text('changed_by').notNull(),
		targetUser: text('target_user').notNull(),
		oldRole: text('old_role'),
		newRole: text('new_role'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('idx_role_audit_org').on(table.orgId, table.createdAt)]
);

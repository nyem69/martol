/**
 * Database Schema — Martol (PostgreSQL via Drizzle ORM)
 *
 * Better Auth manages: user, session, account, verification, organization, member, invitation
 * We define the application-specific tables here.
 */

import {
	pgTable,
	serial,
	bigserial,
	text,
	timestamp,
	bigint,
	integer,
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
export const attachments = pgTable(
	'attachments',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		messageId: bigint('message_id', { mode: 'number' }),
		orgId: text('org_id').notNull(),
		uploadedBy: text('uploaded_by').notNull(),
		filename: text('filename').notNull(),
		r2Key: text('r2_key').notNull(),
		contentType: text('content_type').notNull(),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_attachments_r2_key').on(table.r2Key),
		index('idx_attachments_message_id').on(table.messageId),
		index('idx_attachments_org_message').on(table.orgId, table.messageId),
		index('idx_attachments_org_uploaded_by').on(table.orgId, table.uploadedBy)
	]
);

/**
 * Todos — pinned messages as actionable items
 */
export const todos = pgTable(
	'todos',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		messageId: bigint('message_id', { mode: 'number' }).notNull(),
		orgId: text('org_id').notNull(),
		status: text('status').notNull().default('todo').$type<'todo' | 'done'>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_todos_org_status').on(table.orgId, table.status)
	]
);

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

// ── Auth & Onboarding (docs/003-Auth.md) ────────────────────────────

/**
 * Username History — tracks username changes for impersonation prevention.
 * Old usernames held for 90 days after change.
 */
export const usernameHistory = pgTable(
	'username_history',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: text('user_id').notNull(),
		oldUsername: text('old_username').notNull(),
		newUsername: text('new_username').notNull(),
		changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
		releasedAt: timestamp('released_at', { withTimezone: true }) // changedAt + 90 days
	},
	(table) => [
		index('idx_username_history_user').on(table.userId),
		index('idx_username_history_old').on(table.oldUsername)
	]
);

/**
 * Terms Versions — versioned legal documents (ToS, Privacy Policy, AUP).
 * Re-acceptance prompted when version changes.
 */
export const termsVersions = pgTable('terms_versions', {
	id: serial('id').primaryKey(),
	version: text('version').notNull().unique(),
	type: text('type').notNull().$type<'tos' | 'privacy' | 'aup'>(),
	summary: text('summary').notNull(),
	url: text('url').notNull(),
	effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Terms Acceptances — audit trail of user consent.
 * Records IP, user agent, timestamp per acceptance.
 */
export const termsAcceptances = pgTable(
	'terms_acceptances',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: text('user_id').notNull(),
		termsVersionId: integer('terms_version_id').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_terms_acceptances_user_version').on(table.userId, table.termsVersionId),
		index('idx_terms_acceptances_user').on(table.userId)
	]
);

/**
 * Account Audit — append-only log of account-level events.
 * Tracks email changes, 2FA changes, username changes, logins, OTP events.
 */
export const accountAudit = pgTable(
	'account_audit',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: text('user_id').notNull(),
		action: text('action')
			.notNull()
			.$type<
				| 'email_change'
				| 'email_revert'
				| '2fa_enable'
				| '2fa_disable'
				| 'username_change'
				| 'account_delete'
				| 'login_success'
				| 'login_failed'
				| 'otp_sent'
				| 'otp_failed'
			>(),
		oldValue: text('old_value'),
		newValue: text('new_value'),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_account_audit_user').on(table.userId, table.createdAt),
		index('idx_account_audit_action').on(table.action, table.createdAt)
	]
);

/**
 * Content Reports — user-submitted content moderation reports.
 * Reports go to room owner + platform admin queue.
 */
export const contentReports = pgTable(
	'content_reports',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		messageId: bigint('message_id', { mode: 'number' }),
		reporterId: text('reporter_id').notNull(),
		reason: text('reason')
			.notNull()
			.$type<'csam' | 'nsfw' | 'spam' | 'scam' | 'harassment' | 'other'>(),
		details: text('details'),
		status: text('status')
			.notNull()
			.default('pending')
			.$type<'pending' | 'reviewed' | 'actioned' | 'dismissed'>(),
		reviewedBy: text('reviewed_by'),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		actionTaken: text('action_taken'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_content_reports_org').on(table.orgId, table.status),
		index('idx_content_reports_message').on(table.messageId)
	]
);

/**
 * User Sanctions — moderation actions applied to users.
 * Types: warning, mute (timed), suspend, ban.
 */
export const userSanctions = pgTable(
	'user_sanctions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: text('user_id').notNull(),
		sanctionType: text('sanction_type')
			.notNull()
			.$type<'warning' | 'mute' | 'suspend' | 'ban'>(),
		reason: text('reason').notNull(),
		reportId: bigint('report_id', { mode: 'number' }),
		issuedBy: text('issued_by').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_user_sanctions_user').on(table.userId),
		index('idx_user_sanctions_active').on(table.userId, table.sanctionType)
	]
);

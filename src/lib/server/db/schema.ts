/**
 * Database Schema — Martol (PostgreSQL via Drizzle ORM)
 *
 * Better Auth manages: user, session, account, verification, organization, member, invitation
 * We define the application-specific tables here.
 */

// TODO: LO-09 — Add CHECK(length(id) <= 128) to auth table PKs (deferred: Better Auth managed)

import {
	pgTable,
	serial,
	bigserial,
	text,
	timestamp,
	bigint,
	integer,
	real,
	boolean,
	jsonb,
	date,
	uniqueIndex,
	index,
	primaryKey,
	check,
	foreignKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user, organization } from './auth-schema';

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
		editedAt: timestamp('edited_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_messages_org_id').on(table.orgId, table.id),
		index('idx_messages_org_sender').on(table.orgId, table.senderId, table.id),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.senderId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.replyTo], foreignColumns: [table.id] }).onDelete('set null')
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
		processingStatus: text('processing_status')
			.default('skipped')
			.notNull()
			.$type<'pending' | 'processing' | 'indexed' | 'failed' | 'skipped'>(),
		parserName: text('parser_name'),
		parserVersion: text('parser_version'),
		extractedTextBytes: bigint('extracted_text_bytes', { mode: 'number' }),
		extractionErrorCode: text('extraction_error_code'),
		extractedAt: timestamp('extracted_at', { withTimezone: true }),
		indexedAt: timestamp('indexed_at', { withTimezone: true }),
		contentSha256: text('content_sha256'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_attachments_r2_key').on(table.r2Key),
		index('idx_attachments_message_id').on(table.messageId),
		index('idx_attachments_org_message').on(table.orgId, table.messageId),
		index('idx_attachments_org_uploaded_by').on(table.orgId, table.uploadedBy),
		foreignKey({ columns: [table.messageId], foreignColumns: [messages.id] }).onDelete('set null'),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.uploadedBy], foreignColumns: [user.id] }).onDelete('restrict')
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
		index('idx_todos_org_status').on(table.orgId, table.status),
		foreignKey({ columns: [table.messageId], foreignColumns: [messages.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict')
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
		uniqueIndex('idx_agent_room_bindings_agent_user').on(table.agentUserId),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.agentUserId], foreignColumns: [user.id] }).onDelete('cascade')
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
		primaryKey({ columns: [table.orgId, table.agentUserId] }),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.agentUserId], foreignColumns: [user.id] }).onDelete('cascade')
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
		primaryKey({ columns: [table.orgId, table.userId] }),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
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
		simulationType: text('simulation_type').$type<'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom'>(),
		simulationPayload: jsonb('simulation_payload'),
		riskFactors: jsonb('risk_factors'),
		estimatedImpact: jsonb('estimated_impact'),
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
		index('idx_pending_actions_org_status').on(table.orgId, table.status, table.createdAt),
		check('chk_pa_status', sql`${table.status} IN ('pending', 'approved', 'rejected', 'expired', 'executed')`),
		check('chk_pa_risk', sql`${table.riskLevel} IN ('low', 'medium', 'high')`),
		check('chk_pa_action_type', sql`${table.actionType} IN ('question_answer', 'code_review', 'code_write', 'code_modify', 'code_delete', 'deploy', 'config_change')`),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.triggerMessageId], foreignColumns: [messages.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.requestedBy], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.agentUserId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.approvedBy], foreignColumns: [user.id] }).onDelete('set null')
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
	(table) => [
		index('idx_role_audit_org').on(table.orgId, table.createdAt),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.changedBy], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.targetUser], foreignColumns: [user.id] }).onDelete('restrict')
	]
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
		index('idx_username_history_old').on(table.oldUsername),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
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
		index('idx_terms_acceptances_user').on(table.userId),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.termsVersionId], foreignColumns: [termsVersions.id] }).onDelete('restrict')
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
		index('idx_account_audit_action').on(table.action, table.createdAt),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('restrict')
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
		index('idx_content_reports_message').on(table.messageId),
		check('chk_cr_status', sql`${table.status} IN ('pending', 'reviewed', 'dismissed', 'actioned')`),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.messageId], foreignColumns: [messages.id] }).onDelete('set null'),
		foreignKey({ columns: [table.reporterId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.reviewedBy], foreignColumns: [user.id] }).onDelete('set null')
	]
);

/**
 * Subscriptions — org-level billing via Stripe
 * One subscription per org. Free orgs may not have a row (default to free).
 */
export const subscriptions = pgTable(
	'subscriptions',
	{
		id: text('id').primaryKey(), // nanoid
		orgId: text('org_id').notNull(),
		stripeCustomerId: text('stripe_customer_id').notNull(),
		stripeSubscriptionId: text('stripe_subscription_id').unique(),
		plan: text('plan').notNull().default('free').$type<'free' | 'pro'>(),
		status: text('status')
			.notNull()
			.default('active')
			.$type<'active' | 'past_due' | 'canceled' | 'incomplete'>(),
		quantity: integer('quantity').notNull().default(1),
		foundingMember: boolean('founding_member').notNull().default(false),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		storageBytesUsed: bigint('storage_bytes_used', { mode: 'number' }).default(0).notNull(),
		aiOverageCapCents: integer('ai_overage_cap_cents').default(5000).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_subscriptions_org').on(table.orgId),
		index('idx_subscriptions_stripe_customer').on(table.stripeCustomerId),
		index('idx_subscriptions_stripe_sub').on(table.stripeSubscriptionId),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict')
	]
);

/**
 * Teams — group billing. Owner pays for N seats, assigns Pro to users.
 * Each assigned user gets Pro across all their rooms.
 */
export const teams = pgTable(
	'teams',
	{
		id: text('id').primaryKey(), // nanoid
		ownerId: text('owner_id').notNull(),
		name: text('name').notNull(),
		stripeCustomerId: text('stripe_customer_id'),
		stripeSubscriptionId: text('stripe_subscription_id').unique(),
		seats: integer('seats').notNull().default(5),
		status: text('status')
			.notNull()
			.default('incomplete')
			.$type<'active' | 'past_due' | 'canceled' | 'incomplete'>(),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_teams_owner').on(table.ownerId),
		index('idx_teams_stripe_sub').on(table.stripeSubscriptionId),
		foreignKey({ columns: [table.ownerId], foreignColumns: [user.id] }).onDelete('restrict')
	]
);

/**
 * Team Members — users assigned Pro via a team.
 * A user can be in multiple teams (each team pays independently).
 */
export const teamMembers = pgTable(
	'team_members',
	{
		id: text('id').primaryKey(), // nanoid
		teamId: text('team_id').notNull(),
		userId: text('user_id').notNull(),
		assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_team_members_unique').on(table.teamId, table.userId),
		index('idx_team_members_user').on(table.userId),
		foreignKey({ columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
	]
);

/**
 * Test Account Credentials — password hashes for test accounts.
 * Only used by the test-login endpoint. Never populated in production.
 */
export const testAccountCredentials = pgTable('test_account_credentials', {
	userId: text('user_id').primaryKey(),
	passwordHash: text('password_hash').notNull()
}, (table) => [
	foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
]);

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
		index('idx_user_sanctions_active').on(table.userId, table.sanctionType),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.reportId], foreignColumns: [contentReports.id] }).onDelete('set null'),
		foreignKey({ columns: [table.issuedBy], foreignColumns: [user.id] }).onDelete('restrict')
	]
);

// ── Support Tickets ─────────────────────────────────────────────────

/**
 * Support Tickets — user-submitted support requests.
 * Visible to submitter + platform admins. Agents can read/comment via MCP.
 */
export const supportTickets = pgTable(
	'support_tickets',
	{
		id: text('id').primaryKey(), // nanoid
		userId: text('user_id').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull(),
		category: text('category')
			.notNull()
			.default('other')
			.$type<'bug' | 'feature_request' | 'question' | 'issue' | 'other'>(),
		status: text('status')
			.notNull()
			.default('open')
			.$type<'open' | 'in_progress' | 'resolved' | 'closed'>(),
		assignedTo: jsonb('assigned_to').$type<string[]>(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedBy: text('resolved_by'),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		closedBy: text('closed_by'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_support_tickets_user').on(table.userId, table.createdAt),
		index('idx_support_tickets_status').on(table.status, table.createdAt),
		check(
			'chk_st_category',
			sql`${table.category} IN ('bug', 'feature_request', 'question', 'issue', 'other')`
		),
		check(
			'chk_st_status',
			sql`${table.status} IN ('open', 'in_progress', 'resolved', 'closed')`
		),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('restrict'),
		foreignKey({ columns: [table.resolvedBy], foreignColumns: [user.id] }).onDelete('set null'),
		foreignKey({ columns: [table.closedBy], foreignColumns: [user.id] }).onDelete('set null')
	]
);

/**
 * Ticket Comments — threaded discussion on support tickets.
 * Both humans and MCP agents can comment (mutually exclusive userId/agentUserId).
 */
export const ticketComments = pgTable(
	'ticket_comments',
	{
		id: text('id').primaryKey(), // nanoid
		ticketId: text('ticket_id').notNull(),
		userId: text('user_id'),
		agentUserId: text('agent_user_id'),
		content: text('content').notNull(),
		parentId: text('parent_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ticket_comments_ticket').on(table.ticketId, table.createdAt),
		foreignKey({ columns: [table.ticketId], foreignColumns: [supportTickets.id] }).onDelete(
			'cascade'
		),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('set null'),
		foreignKey({ columns: [table.agentUserId], foreignColumns: [user.id] }).onDelete('set null'),
		foreignKey({ columns: [table.parentId], foreignColumns: [table.id] }).onDelete('set null')
	]
);

// ── RAG Pipeline & AI Usage ─────────────────────────────────

/**
 * AI Usage — metered billing tracking per org per operation per day.
 * Used for free tier allowance checks and Stripe overage reporting.
 */
export const aiUsage = pgTable(
	'ai_usage',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		operation: text('operation')
			.notNull()
			.$type<'doc_process' | 'vector_query' | 'llm_generation'>(),
		count: integer('count').default(0).notNull(),
		periodStart: date('period_start').notNull()
	},
	(table) => [
		uniqueIndex('idx_ai_usage_org_op_period').on(table.orgId, table.operation, table.periodStart),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict')
	]
);

/**
 * Room Config — per-room feature configuration.
 * Stores RAG responder settings and future room-level feature flags.
 */
export const roomConfig = pgTable(
	'room_config',
	{
		orgId: text('org_id')
			.primaryKey()
			.references(() => organization.id, { onDelete: 'cascade' }),
		ragEnabled: boolean('rag_enabled').notNull().default(false),
		ragModel: text('rag_model').notNull().default('@cf/meta/llama-3.1-8b-instruct'),
		ragTemperature: real('rag_temperature').notNull().default(0.3),
		ragMaxTokens: integer('rag_max_tokens').notNull().default(2048),
		ragTrigger: text('rag_trigger')
			.notNull()
			.default('explicit')
			.$type<'explicit' | 'always'>(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
		updatedBy: text('updated_by').references(() => user.id)
	},
	(table) => [
		check('chk_rag_trigger', sql`rag_trigger IN ('explicit', 'always')`)
	]
);

/**
 * Document Chunks — text chunks from parsed documents, indexed in Vectorize.
 * Source of truth for re-indexing; Vectorize is the search layer.
 */
export const documentChunks = pgTable(
	'document_chunks',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		attachmentId: bigint('attachment_id', { mode: 'number' }).notNull(),
		orgId: text('org_id').notNull(),
		chunkIndex: integer('chunk_index').notNull(),
		content: text('content').notNull(),
		vectorId: text('vector_id').notNull(),
		tokenCount: integer('token_count').notNull(),
		pageStart: integer('page_start'),
		pageEnd: integer('page_end'),
		charStart: integer('char_start'),
		charEnd: integer('char_end'),
		chunkHash: text('chunk_hash'),
		embeddingModel: text('embedding_model'),
		embeddingDim: integer('embedding_dim'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
	},
	(table) => [
		index('idx_doc_chunks_attachment').on(table.attachmentId),
		index('idx_doc_chunks_org').on(table.orgId),
		foreignKey({ columns: [table.attachmentId], foreignColumns: [attachments.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict')
	]
);

/**
 * Ingestion Jobs — tracks async document processing jobs.
 * Enables retries, error tracking, and operational visibility.
 */
export const ingestionJobs = pgTable(
	'ingestion_jobs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		attachmentId: bigint('attachment_id', { mode: 'number' }).notNull(),
		orgId: text('org_id').notNull(),
		jobType: text('job_type')
			.notNull()
			.$type<'extract' | 'chunk' | 'embed' | 'reindex' | 'delete_cleanup'>(),
		status: text('status')
			.notNull()
			.default('pending')
			.$type<'pending' | 'running' | 'completed' | 'failed'>(),
		attemptCount: integer('attempt_count').default(0).notNull(),
		error: text('error'),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_ingestion_jobs_attachment').on(table.attachmentId),
		index('idx_ingestion_jobs_status').on(table.status, table.createdAt),
		foreignKey({ columns: [table.attachmentId], foreignColumns: [attachments.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('restrict')
	]
);

/**
 * Versioned Project Brief
 *
 * Stores versioned brief snapshots per organization (room).
 * A partial unique index enforces exactly one active brief per org.
 * Old briefs are archived (status = 'archived') when a new version is saved.
 */
export const projectBrief = pgTable(
	'project_brief',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		orgId: text('org_id').notNull(),
		content: text('content').notNull(),
		version: integer('version').notNull().default(1),
		status: text('status').notNull().default('active').$type<'active' | 'archived'>(),
		createdBy: text('created_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_project_brief_org_active')
			.on(table.orgId)
			.where(sql`status = 'active'`),
		index('idx_project_brief_org_version').on(table.orgId, table.version),
		check('chk_pb_status', sql`status IN ('active', 'archived')`),
		foreignKey({ columns: [table.orgId], foreignColumns: [organization.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.createdBy], foreignColumns: [user.id] }).onDelete('restrict')
	]
);

// ── Contact Form ────────────────────────────────────────────────────

/**
 * Contact Submissions — public contact form entries.
 * No auth required; rate-limited by IP. Forwarded to EMAIL_FROM on submit.
 */
export const contactSubmissions = pgTable(
	'contact_submissions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		subject: text('subject').notNull(),
		message: text('message').notNull(),
		ip: text('ip'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_contact_submissions_created').on(table.createdAt)
	]
);

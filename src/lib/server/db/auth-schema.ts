/**
 * Better Auth Schema — Drizzle table definitions
 *
 * These tables are managed by Better Auth (core + plugins: emailOTP, organization, apiKey).
 * Generated manually from Better Auth 1.4.x docs.
 * Re-generate with: npx @better-auth/cli generate
 */

import { pgTable, text, boolean, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';

// ── Core tables ──────────────────────────────────────────────────────

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('emailVerified').notNull(),
	image: text('image'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull()
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expiresAt').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId')
		.notNull()
		.references(() => user.id),
	activeOrganizationId: text('activeOrganizationId')
});

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('accountId').notNull(),
	providerId: text('providerId').notNull(),
	userId: text('userId')
		.notNull()
		.references(() => user.id),
	accessToken: text('accessToken'),
	refreshToken: text('refreshToken'),
	idToken: text('idToken'),
	accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
	refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull()
});

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expiresAt').notNull(),
	createdAt: timestamp('createdAt'),
	updatedAt: timestamp('updatedAt')
});

// ── Organization plugin ──────────────────────────────────────────────

export const organization = pgTable('organization', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').unique(),
	logo: text('logo'),
	createdAt: timestamp('createdAt').notNull(),
	metadata: text('metadata')
});

export const member = pgTable(
	'member',
	{
		id: text('id').primaryKey(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id),
		userId: text('userId')
			.notNull()
			.references(() => user.id),
		role: text('role').notNull(),
		createdAt: timestamp('createdAt').notNull()
	},
	(table) => [
		uniqueIndex('idx_member_org_user').on(table.organizationId, table.userId)
	]
);

export const invitation = pgTable('invitation', {
	id: text('id').primaryKey(),
	organizationId: text('organizationId')
		.notNull()
		.references(() => organization.id),
	email: text('email').notNull(),
	role: text('role'),
	status: text('status').notNull(),
	expiresAt: timestamp('expiresAt').notNull(),
	inviterId: text('inviterId')
		.notNull()
		.references(() => user.id)
});

// ── API Key plugin ───────────────────────────────────────────────────

export const apikey = pgTable('apikey', {
	id: text('id').primaryKey(),
	name: text('name'),
	start: text('start'),
	prefix: text('prefix'),
	key: text('key').notNull(),
	userId: text('userId')
		.notNull()
		.references(() => user.id),
	refillInterval: integer('refillInterval'),
	refillAmount: integer('refillAmount'),
	lastRefillAt: timestamp('lastRefillAt'),
	enabled: boolean('enabled'),
	rateLimitEnabled: boolean('rateLimitEnabled'),
	rateLimitTimeWindow: integer('rateLimitTimeWindow'),
	rateLimitMax: integer('rateLimitMax'),
	requestCount: integer('requestCount'),
	remaining: integer('remaining'),
	lastRequest: timestamp('lastRequest'),
	expiresAt: timestamp('expiresAt'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
	permissions: text('permissions'),
	metadata: text('metadata')
});

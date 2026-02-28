/**
 * Better Auth Configuration — Martol
 *
 * Connects to PostgreSQL via Hyperdrive (production) or direct pool (local dev).
 * Plugins: emailOTP, organization (rooms = orgs), apiKey (agent auth).
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, organization, apiKey } from 'better-auth/plugins';
import { sendEmail, otpEmailTemplate } from '$lib/server/email';
import * as authSchema from '$lib/server/db/auth-schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

interface EmailConfig {
	resendApiKey?: string;
	emailFrom?: string;
	emailName?: string;
}

interface KVSecondaryStorage {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
}

/**
 * Wrap Cloudflare KV as Better Auth secondaryStorage
 */
function createKVStorage(kv?: KVNamespace): KVSecondaryStorage | undefined {
	if (!kv) return undefined;
	return {
		get: async (key: string) => kv.get(key),
		set: async (key: string, value: string, ttl?: number) => {
			await kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
		},
		delete: async (key: string) => {
			await kv.delete(key);
		}
	};
}

/**
 * Create Better Auth instance per-request.
 *
 * @param db - Drizzle ORM instance (PostgreSQL)
 * @param secret - Better Auth secret for session encryption
 * @param baseURL - Application base URL (for callbacks and magic links)
 * @param emailConfig - Resend email configuration
 * @param kv - Optional Cloudflare KV for session cache
 */
export function createAuth(
	db: NodePgDatabase<any>,
	secret: string,
	baseURL: string,
	emailConfig: EmailConfig,
	kv?: KVNamespace
) {
	const auth = betterAuth({
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: authSchema
		}),

		secret,
		baseURL,

		plugins: [
			// Passwordless email OTP
			emailOTP({
				expiresIn: 60 * 15, // 15 minutes
				otpLength: 6,
				disableSignUp: false,
				sendVerificationOTP: async ({ email, otp }) => {
					if (!emailConfig.resendApiKey) {
						if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
							console.warn(`[Auth] DEV ONLY — OTP for ${email}: ${otp}`);
						} else {
							console.error('[Auth] RESEND_API_KEY not configured — cannot send OTP');
							throw new Error('Email service not configured');
						}
						return;
					}

					const magicUrl = `${baseURL}/api/auth/verify-otp?email=${encodeURIComponent(email)}&code=${otp}`;
					const appName = emailConfig.emailName || 'Martol';
					const { subject, html } = otpEmailTemplate(magicUrl, otp, appName);

					const result = await sendEmail(
						{ to: email, subject, html },
						{
							RESEND_API_KEY: emailConfig.resendApiKey,
							EMAIL_FROM: emailConfig.emailFrom || 'noreply@martol.app',
							EMAIL_NAME: appName
						}
					);

					if (!result.success) {
						console.error('[Auth] Failed to send OTP email:', result.error);
						throw new Error('Failed to send verification code');
					}
				}
			}),

			// Rooms modeled as organizations
			organization(),

			// Agent authentication via API keys
			apiKey()
		],

		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // Refresh every 24 hours
			cookieCache: {
				enabled: true,
				maxAge: 60 * 30 // 30 minutes
			}
		},

		advanced: {
			cookiePrefix: 'martol',
			useSecureCookies: baseURL.startsWith('https')
		},

		trustedOrigins: [
			'http://localhost:5190',
			'http://127.0.0.1:5190',
			// Capacitor schemes
			'capacitor://martol.app',
			'https://martol.app',
			'https://martol.plitix.com'
		]
	});

	return auth;
}

export type Auth = ReturnType<typeof createAuth>;

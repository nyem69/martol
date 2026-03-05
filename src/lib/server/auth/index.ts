/**
 * Better Auth Configuration — Martol
 *
 * Connects to PostgreSQL via Hyperdrive (production) or direct pool (local dev).
 * Plugins: emailOTP, organization (rooms = orgs), apiKey (agent auth),
 *          twoFactor, passkey.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, organization, apiKey, twoFactor } from 'better-auth/plugins';
import { sendEmail, otpEmailTemplate, invitationEmailTemplate } from '$lib/server/email';
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
 * @param kv - Optional Cloudflare KV for session cache and magic link tokens
 */
export function createAuth(
	db: NodePgDatabase<any>,
	secret: string,
	baseURL: string,
	emailConfig: EmailConfig,
	kv?: KVNamespace,
	environment?: string
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
						if ((baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) && environment !== 'production') {
							console.warn(`[Auth] DEV ONLY — OTP for ${email}: ${otp}`);
						} else {
							console.error('[Auth] RESEND_API_KEY not configured — cannot send OTP');
							throw new Error('Email service not configured');
						}
						return;
					}

					// Use opaque token via KV instead of raw OTP in URL
					let magicUrl: string;
					if (kv) {
						const magicToken = crypto.randomUUID();
						await kv.put(
							`magic:${magicToken}`,
							JSON.stringify({ email, otp }),
							{ expirationTtl: 60 * 5 } // 5-minute TTL
						);
						magicUrl = `${baseURL}/api/auth/magic?token=${magicToken}`;
					} else if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
						// Dev-only fallback — raw OTP in URL, acceptable for local testing
						magicUrl = `${baseURL}/api/auth/verify-otp?email=${encodeURIComponent(email)}&code=${otp}`;
					} else {
						// Production without KV — fail hard rather than expose OTP in URL
						console.error('[Auth] CACHE KV binding missing in production — cannot issue magic link');
						throw new Error('Magic link service unavailable');
					}

					const appName = emailConfig.emailName || 'Martol';
					// OTP NOT in email subject line (security: visible on lock screens)
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
			organization({
				async sendInvitationEmail(data) {
					const { id, email, organization: org, inviter } = data;
					if (!emailConfig.resendApiKey) {
						if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
							console.warn(`[Auth] DEV ONLY — Invitation for ${email} to ${org.name} (inviter: ${inviter.user.name || 'unnamed'})`);
							console.warn(`[Auth] DEV ONLY — Accept link: ${baseURL}/accept-invitation/${id}`);
						} else {
							console.error('[Auth] RESEND_API_KEY not configured — cannot send invitation');
							throw new Error('Email service not configured');
						}
						return;
					}

					const inviterName = inviter.user.name || 'A Martol user';
					const acceptUrl = `${baseURL}/accept-invitation/${id}`;
					const { subject, html } = invitationEmailTemplate(inviterName, org.name, acceptUrl);
					const appName = emailConfig.emailName || 'Martol';

					const result = await sendEmail(
						{ to: email, subject, html },
						{
							RESEND_API_KEY: emailConfig.resendApiKey,
							EMAIL_FROM: emailConfig.emailFrom || 'noreply@martol.app',
							EMAIL_NAME: appName
						}
					);

					if (!result.success) {
						console.error('[Auth] Failed to send invitation email:', result.error);
						throw new Error('Failed to send invitation email');
					}
				}
			}),

			// Agent authentication via API keys
			apiKey(),

			// Two-factor authentication (TOTP + backup codes)
			twoFactor({
				issuer: 'Martol',
				backupCodes: {
					length: 10, // characters per code
					count: 8 // number of codes
				}
			})
			// Passkey plugin will be added when available (P1)
		],

		// NO emailAndPassword — agents created via direct DB insert
		// emailAndPassword creates hidden auth bypass (exposes public sign-up/sign-in endpoints)

		user: {
			additionalFields: {
				username: { type: 'string', unique: true, required: false },
				displayName: { type: 'string', required: false },
				ageVerifiedAt: { type: 'date', required: false }
			}
		},

		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // Refresh every 24 hours
			cookieCache: {
				enabled: true,
				maxAge: 60 * 5 // 5 minutes (reduced from 30 for faster revocation)
			}
		},

		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						// Auto-generate username if not set (e.g. user-3f82d9a1)
						if (!user.username) {
							const random = crypto.randomUUID().slice(0, 8);
							return { data: { ...user, username: `user-${random}` } };
						}
						return { data: user };
					}
				}
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

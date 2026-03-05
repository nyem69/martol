/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
	AI: Ai;
	CACHE: KVNamespace;
	HYPERDRIVE: Hyperdrive;
	STORAGE: R2Bucket;
	CHAT_ROOM: DurableObjectNamespace;
	RESEND_API_KEY: string;
	EMAIL_FROM: string;
	EMAIL_NAME: string;
	BETTER_AUTH_SECRET: string;
	HMAC_SIGNING_SECRET: string;
	APP_BASE_URL: string;
	ENVIRONMENT: string;
	SENTRY_DSN: string;
	TURNSTILE_SITE_KEY: string;
	TURNSTILE_SECRET_KEY: string;
	ENABLE_UPLOADS: string;
	ENABLE_IMAGE_SCANNING: string;
	STRIPE_SECRET_KEY: string;
	STRIPE_WEBHOOK_SECRET: string;
	STRIPE_PUBLISHABLE_KEY: string;
	STRIPE_PRO_PRICE_ID: string;
}

declare global {
	const __BUILD_NUMBER__: string;
	namespace App {
		interface Locals {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			auth: any;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			user: any | null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			session: any | null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			db: any | null;
		}

		interface Platform {
			env: CloudflareEnv;
			context: ExecutionContext;
			caches: CacheStorage & { default: Cache };
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}
}

export { CloudflareEnv };

/**
 * Rate Limiting via Cloudflare KV — Martol
 *
 * Simple sliding-window rate limiter using KV counters with TTL.
 * KV is eventually consistent, which is acceptable for rate limiting —
 * a few extra requests may slip through under high concurrency, but
 * that's fine for OTP abuse prevention.
 */

export interface RateLimitConfig {
	/** Full KV key (e.g. "rl:otp-ip:1.2.3.4") */
	key: string;
	/** Maximum requests allowed within the window */
	maxRequests: number;
	/** Window duration in seconds (used as KV TTL) */
	windowSeconds: number;
}

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Remaining requests in the current window */
	remaining: number;
}

/**
 * Check and increment a rate limit counter in Cloudflare KV.
 *
 * Key format: `rl:{config.key}`
 * Value: JSON `{ count: number, windowStart: number }`
 * TTL: config.windowSeconds (auto-expires stale windows)
 */
export async function checkRateLimit(
	kv: KVNamespace,
	config: RateLimitConfig,
	failClosed: boolean = false
): Promise<RateLimitResult> {
	const kvKey = `rl:${config.key}`;
	const now = Math.floor(Date.now() / 1000);

	try {
		const existing = await kv.get(kvKey);

		if (existing) {
			const data = JSON.parse(existing) as { count: number; windowStart: number };
			const windowAge = now - data.windowStart;

			// Window still active
			if (windowAge < config.windowSeconds) {
				const newCount = data.count + 1;

				if (newCount > config.maxRequests) {
					return { allowed: false, remaining: 0 };
				}

				// Increment counter, keep remaining TTL
				const remainingTtl = config.windowSeconds - windowAge;
				await kv.put(
					kvKey,
					JSON.stringify({ count: newCount, windowStart: data.windowStart }),
					{ expirationTtl: Math.max(remainingTtl, 60) }
				);

				return { allowed: true, remaining: config.maxRequests - newCount };
			}
			// Window expired — fall through to create new window
		}

		// New window: first request
		await kv.put(
			kvKey,
			JSON.stringify({ count: 1, windowStart: now }),
			{ expirationTtl: config.windowSeconds }
		);

		return { allowed: true, remaining: config.maxRequests - 1 };
	} catch (error) {
		if (failClosed) {
			console.error('[RateLimit] KV error, BLOCKING request (fail-closed):', error);
			return { allowed: false, remaining: 0 };
		}
		console.error('[RateLimit] KV error, allowing request (fail-open):', error);
		return { allowed: true, remaining: config.maxRequests };
	}
}

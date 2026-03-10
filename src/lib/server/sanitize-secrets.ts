/**
 * sanitize-secrets.ts — Aggressive secret stripping for user-facing exports.
 *
 * Replaces recognized secret patterns with [SECRET].
 * Used by chat export (HTML) and GDPR data export (JSON).
 *
 * Pure module — no imports, Cloudflare Workers compatible, stateless.
 */

type Replacement = string | ((match: string, ...args: string[]) => string);

/**
 * Ordered list of [regex, replacement] pairs.
 * Applied sequentially — most specific patterns first.
 */
const SECRET_PATTERNS: Array<[RegExp, Replacement]> = [
	// PEM private/public keys (multiline)
	[/-----BEGIN [A-Z ]*(?:PRIVATE|PUBLIC) KEY-----[\s\S]*?-----END [A-Z ]*(?:PRIVATE|PUBLIC) KEY-----/g, '[SECRET]'],

	// JWTs — three base64url segments separated by dots
	[/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[SECRET]'],

	// AWS access key IDs
	[/\bAKIA[A-Z0-9]{16}\b/g, '[SECRET]'],

	// GitHub tokens
	[/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, '[SECRET]'],

	// Connection strings
	[/(?:postgres|postgresql|mysql|redis|mongodb|amqp|amqps):\/\/[^\s"'`]+/gi, '[SECRET]'],

	// Common API key prefixes (sk-, pk-, key_, ak_, rk_, etc.)
	[/\b(?:sk|pk|rk|ak|dk|mk)-[A-Za-z0-9_-]{16,}/g, '[SECRET]'],
	[/\bkey_[A-Za-z0-9_-]{16,}/g, '[SECRET]'],

	// Key=value patterns (secret=, token=, password=, apikey=, api_key=, passwd=, pwd=, etc.)
	[/(?:secret|token|password|passwd|pwd|apikey|api_key|access_key|auth_key|private_key|client_secret)\s*[=:]\s*["']?[A-Za-z0-9+/=_.\-]{8,}["']?/gi,
		(match: string) => {
			const eqIdx = match.search(/[=:]/);
			return match.slice(0, eqIdx + 1) + ' [SECRET]';
		}],

	// Bearer tokens in Authorization headers
	[/Bearer\s+[A-Za-z0-9+/=_.\-]{16,}/gi, 'Bearer [SECRET]'],

	// Hex strings longer than 64 chars (likely private keys, not git SHAs)
	[/\b[0-9a-f]{65,}\b/gi, '[SECRET]'],

	// Base64 strings longer than 64 chars (not already matched as JWT)
	[/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{64,}={0,2}(?![A-Za-z0-9+/=])/g, '[SECRET]'],
];

/**
 * Strip recognized secret patterns from a text string.
 * Returns the sanitized string with secrets replaced by [SECRET].
 */
export function stripSecrets(text: string): string {
	if (!text) return text;
	let result = text;
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		if (pattern.global) pattern.lastIndex = 0;
		result = result.replace(pattern, replacement as string);
	}
	return result;
}

/**
 * Strip secrets from a nullable text field.
 */
export function stripSecretsNullable(text: string | null | undefined): typeof text {
	if (text == null) return text;
	return stripSecrets(text);
}

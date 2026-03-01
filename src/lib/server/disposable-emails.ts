/**
 * Disposable Email Domain Denylist — Martol
 *
 * Blocks throwaway/temporary email providers to prevent OTP abuse.
 * This list covers major disposable email services. It can be extended
 * as needed — check community-maintained lists periodically.
 *
 * IMPORTANT: Blocked emails receive the same 200 OK response as
 * successful OTP sends to prevent enumeration.
 */

export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
	// Major disposable email providers
	'mailinator.com',
	'tempmail.com',
	'throwaway.email',
	'guerrillamail.com',
	'yopmail.com',
	'sharklasers.com',
	'grr.la',
	'guerrillamailblock.com',
	'pokemail.net',
	'spam4.me',

	// Trashmail family
	'trashmail.com',
	'trashmail.me',
	'trashmail.net',

	// Other popular disposable services
	'dispostable.com',
	'maildrop.cc',
	'mailnesia.com',
	'tempr.email',
	'tempail.com',
	'mohmal.com',
	'10minutemail.com',
	'minutemail.com',
	'temp-mail.org',
	'harakirimail.com',
	'fake-box.com',
	'getnada.com',
	'emailondeck.com',
	'mailcatch.com',
	'inboxbear.com',
	'disposableemailaddresses.emailmiser.com',

	// Fake identity generators (spambot-friendly)
	'armyspy.com',
	'cuvox.de',
	'dayrep.com',
	'einrot.com',
	'fleckens.hu',
	'gustr.com',
	'jourrapide.com',
	'rhyta.com',
	'superrito.com',
	'teleworm.us'
]);

/**
 * Check if an email address uses a known disposable domain.
 */
export function isDisposableEmail(email: string): boolean {
	const domain = email.split('@')[1]?.toLowerCase();
	return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

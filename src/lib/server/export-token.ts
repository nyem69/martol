/**
 * HMAC-SHA256 token signing/verification for export download links.
 */

/** Sign a payload string with HMAC-SHA256 */
export async function signExportToken(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Verify HMAC-SHA256 signature */
export async function verifyExportToken(payload: string, signature: string, secret: string): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
}

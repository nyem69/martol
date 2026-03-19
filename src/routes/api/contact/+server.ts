/**
 * Contact Form API — Martol
 *
 * POST /api/contact — Save submission to DB and forward to EMAIL_FROM.
 * No auth required. Rate-limited by IP.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { contactSubmissions } from '$lib/server/db/schema';
import { sendEmail } from '$lib/server/email';

const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 254;
const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory rate limit: max 3 submissions per IP per 10 minutes
// NOTE: In-memory rate limit is per-isolate. Under high concurrency,
// different isolates may each allow their own limit. For stronger
// protection, use KV-based rate limiting (like the upload endpoint).
const rateMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 3;

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const timestamps = rateMap.get(ip)?.filter((t) => now - t < RATE_WINDOW_MS) ?? [];
	if (timestamps.length >= RATE_LIMIT) return true;
	timestamps.push(now);
	rateMap.set(ip, timestamps);
	return false;
}

export const POST: RequestHandler = async ({ request, locals, platform, getClientAddress }) => {
	if (!locals.db) error(503, 'Database unavailable');

	const ip = getClientAddress();
	if (isRateLimited(ip)) {
		return json({ ok: false, error: 'Too many submissions. Please try again later.' }, { status: 429 });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
	const message = typeof body.message === 'string' ? body.message.trim() : '';

	if (!name || name.length > MAX_NAME_LEN) error(400, 'Name is required (max 100 characters)');
	if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN) error(400, 'Valid email is required');
	if (!subject || subject.length > MAX_SUBJECT_LEN) error(400, 'Subject is required (max 200 characters)');
	if (!message || message.length > MAX_MESSAGE_LEN) error(400, 'Message is required (max 5000 characters)');

	// Save to DB
	await locals.db.insert(contactSubmissions).values({
		name,
		email,
		subject,
		message,
		ip
	});

	// Forward to EMAIL_FROM
	const emailFrom = platform?.env?.EMAIL_FROM || process.env.EMAIL_FROM || 'noreply@martol.app';
	const emailName = platform?.env?.EMAIL_NAME || process.env.EMAIL_NAME || 'Martol';
	const resendApiKey = platform?.env?.RESEND_API_KEY || process.env.RESEND_API_KEY || '';

	if (resendApiKey) {
		const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const escapedEmail = email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const escapedSubject = subject.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const escapedMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

		await sendEmail(
			{
				to: emailFrom,
				subject: `[Martol Contact] ${subject}`,
				html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">MARTOL</h1>
  </div>
  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">New Contact Submission</h2>
    <table style="width: 100%; font-size: 14px; color: #a0a0a8;">
      <tr><td style="padding: 6px 0; color: #6a6a72; width: 80px;">From</td><td style="padding: 6px 0;"><strong style="color: #e8e8e8;">${escapedName}</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #6a6a72;">Email</td><td style="padding: 6px 0;"><a href="mailto:${escapedEmail}" style="color: #c49a3c;">${escapedEmail}</a></td></tr>
      <tr><td style="padding: 6px 0; color: #6a6a72;">Subject</td><td style="padding: 6px 0; color: #e8e8e8;">${escapedSubject}</td></tr>
    </table>
    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">
    <div style="color: #a0a0a8; font-size: 15px; line-height: 1.7;">${escapedMessage}</div>
    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">
    <p style="font-size: 12px; color: #4a4a52; margin: 0;">Reply directly to this email to respond to the sender.</p>
  </div>
</body>
</html>`
			},
			{
				RESEND_API_KEY: resendApiKey,
				EMAIL_FROM: emailFrom,
				EMAIL_NAME: emailName
			}
		);
	}

	return json({ ok: true });
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isTestAccountEmail, verifyTestPassword } from '$lib/server/auth/test-accounts';
import { user, session } from '$lib/server/db/auth-schema';
import { testAccountCredentials } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
	// Gate: TEST_ACCOUNTS_ENABLED must be set
	const cfEnabled = (platform?.env as Record<string, string> | undefined)?.TEST_ACCOUNTS_ENABLED;
	const nodeEnabled = process.env.TEST_ACCOUNTS_ENABLED;
	const raw = cfEnabled ?? nodeEnabled;
	const enabled = raw === 'true' || raw === '1';

	if (!enabled) {
		throw error(404, 'Not found');
	}

	// Require DB connection
	if (!locals.db) {
		throw error(503, 'Service unavailable');
	}

	const db = locals.db;

	// Parse body
	let body: { email?: string; password?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const { email, password } = body;

	if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
		throw error(400, 'Missing email or password');
	}

	// Validate test account email
	if (!isTestAccountEmail(email)) {
		throw error(401, 'Invalid credentials');
	}

	// Look up user by email
	const [foundUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);
	if (!foundUser) {
		throw error(401, 'Invalid credentials');
	}

	// Look up password hash
	const [creds] = await db
		.select()
		.from(testAccountCredentials)
		.where(eq(testAccountCredentials.userId, foundUser.id))
		.limit(1);

	if (!creds) {
		throw error(401, 'Invalid credentials');
	}

	// Verify password
	const valid = await verifyTestPassword(password, creds.passwordHash);
	if (!valid) {
		throw error(401, 'Invalid credentials');
	}

	// Create session directly in DB
	const sessionId = crypto.randomUUID();
	const token = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

	await db.insert(session).values({
		id: sessionId,
		userId: foundUser.id,
		token,
		expiresAt,
		createdAt: now,
		updatedAt: now
	});

	// Set session cookie
	cookies.set('martol.session_token', token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 7 * 24 * 60 * 60
	});

	console.log(`[TestAuth] Login: ${email}`);

	return json({
		ok: true,
		user: {
			id: foundUser.id,
			email: foundUser.email,
			username: foundUser.username
		},
		redirectTo: '/chat'
	});
};

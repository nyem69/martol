import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

function scryptAsync(
	password: string | Buffer,
	salt: string | Buffer,
	keylen: number,
	options: { N: number; r: number; p: number },
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, keylen, options, (err, derived) => {
			if (err) reject(err);
			else resolve(derived);
		});
	});
}

// scrypt parameters
const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;

export interface TestAccount {
	id: string;
	email: string;
	password: string;
	username: string;
	displayName: string;
	planState: 'free' | 'pro' | 'pro_founding' | 'team_owner' | 'team_member' | 'canceled' | 'past_due';
}

export const TEST_ACCOUNTS: TestAccount[] = [
	{
		id: 'test-free-0000-0000-000000000001',
		email: 'test-free@martol.test',
		password: 'TestFree123!',
		username: 'test-free',
		displayName: 'Test Free User',
		planState: 'free',
	},
	{
		id: 'test-pro-0000-0000-000000000002',
		email: 'test-pro@martol.test',
		password: 'TestPro123!',
		username: 'test-pro',
		displayName: 'Test Pro User',
		planState: 'pro',
	},
	{
		id: 'test-found-000-0000-000000000003',
		email: 'test-founder@martol.test',
		password: 'TestFounder123!',
		username: 'test-founder',
		displayName: 'Test Founding Member',
		planState: 'pro_founding',
	},
	{
		id: 'test-owner-000-0000-000000000004',
		email: 'test-team-owner@martol.test',
		password: 'TestTeamOwner123!',
		username: 'test-team-owner',
		displayName: 'Test Team Owner',
		planState: 'team_owner',
	},
	{
		id: 'test-member-00-0000-000000000005',
		email: 'test-team-member@martol.test',
		password: 'TestMember123!',
		username: 'test-team-member',
		displayName: 'Test Team Member',
		planState: 'team_member',
	},
	{
		id: 'test-cancel-00-0000-000000000006',
		email: 'test-canceled@martol.test',
		password: 'TestCanceled123!',
		username: 'test-canceled',
		displayName: 'Test Canceled User',
		planState: 'canceled',
	},
	{
		id: 'test-pastdue-0-0000-000000000007',
		email: 'test-pastdue@martol.test',
		password: 'TestPastdue123!',
		username: 'test-pastdue',
		displayName: 'Test Past Due User',
		planState: 'past_due',
	},
];

export const TEST_ACCOUNT_MAP: Map<string, TestAccount> = new Map(
	TEST_ACCOUNTS.map((account) => [account.email, account]),
);

export function isTestAccountEmail(email: string): boolean {
	return TEST_ACCOUNT_MAP.has(email);
}

/**
 * Hashes a password using scrypt.
 * Format: $scrypt$N$r$p$salt_base64$derived_base64
 */
export async function hashTestPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = (await scryptAsync(password, salt, KEY_LEN, { N, r, p })) as Buffer;
	return `$scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verifies a password against a hash produced by hashTestPassword.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export async function verifyTestPassword(password: string, hash: string): Promise<boolean> {
	const parts = hash.split('$');
	// Format: ['', 'scrypt', N, r, p, salt_base64, derived_base64]
	if (parts.length !== 7 || parts[1] !== 'scrypt') {
		return false;
	}

	const hashN = parseInt(parts[2], 10);
	const hashR = parseInt(parts[3], 10);
	const hashP = parseInt(parts[4], 10);
	const salt = Buffer.from(parts[5], 'base64');
	const storedDerived = Buffer.from(parts[6], 'base64');

	const derived = (await scryptAsync(password, salt, storedDerived.length, {
		N: hashN,
		r: hashR,
		p: hashP,
	})) as Buffer;

	if (derived.length !== storedDerived.length) {
		return false;
	}

	return timingSafeEqual(derived, storedDerived);
}

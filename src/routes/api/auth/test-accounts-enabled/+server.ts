import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const cfEnabled = (platform?.env as Record<string, string> | undefined)?.TEST_ACCOUNTS_ENABLED;
	const nodeEnabled = process.env.TEST_ACCOUNTS_ENABLED;

	const raw = cfEnabled ?? nodeEnabled;
	const enabled = raw === 'true' || raw === '1';

	return json({ enabled });
};

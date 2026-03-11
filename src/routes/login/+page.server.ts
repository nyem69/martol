import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const turnstileSiteKey =
		platform?.env?.TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || '';
	const testAccountsEnabled =
		platform?.env?.TEST_ACCOUNTS_ENABLED === 'true' ||
		process.env.TEST_ACCOUNTS_ENABLED === 'true';
	return { turnstileSiteKey, testAccountsEnabled };
};

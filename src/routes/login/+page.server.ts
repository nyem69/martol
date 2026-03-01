import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const turnstileSiteKey =
		platform?.env?.TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || '';

	return { turnstileSiteKey };
};

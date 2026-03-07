/**
 * Admin Layout Guard — redirects non-admin users
 */

import { redirect, error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');
	if (!locals.isAdmin) error(403, 'Admin access required');

	return {
		isAdmin: true
	};
};

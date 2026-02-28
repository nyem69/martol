/**
 * Better Auth catch-all handler
 *
 * All /api/auth/* requests are delegated to Better Auth.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.auth) error(503, 'Auth service unavailable');
	return locals.auth.handler(request);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.auth) error(503, 'Auth service unavailable');
	return locals.auth.handler(request);
};

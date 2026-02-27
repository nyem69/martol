/**
 * Better Auth catch-all handler
 *
 * All /api/auth/* requests are delegated to Better Auth.
 */

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) => {
	return locals.auth.handler(request);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	return locals.auth.handler(request);
};

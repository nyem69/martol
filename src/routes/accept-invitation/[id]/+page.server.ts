import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, request }) => {
	const invitationId = params.id;

	if (!locals.user || !locals.session) {
		redirect(302, `/login?redirect=/accept-invitation/${invitationId}`);
	}

	if (!locals.auth) {
		redirect(302, '/login');
	}

	try {
		await locals.auth.api.acceptInvitation({
			body: { invitationId },
			headers: request.headers
		});
	} catch (e) {
		console.error('[Invite] Failed to accept invitation:', e);
		// Fallback: auto-accept logic in /chat page.server.ts handles pending invitations
	}

	redirect(302, '/chat');
};

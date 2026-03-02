import { redirect, error } from '@sveltejs/kit';
import { invitation, organization, user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const invitationId = params.id;

	if (!locals.user || !locals.session) {
		redirect(302, `/login?redirect=/accept-invitation/${invitationId}`);
	}

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Fetch invitation with org name and inviter name
	const [invite] = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			orgId: invitation.organizationId,
			orgName: organization.name,
			inviterName: user.name
		})
		.from(invitation)
		.innerJoin(organization, eq(organization.id, invitation.organizationId))
		.innerJoin(user, eq(user.id, invitation.inviterId))
		.where(eq(invitation.id, invitationId))
		.limit(1);

	if (!invite) {
		error(404, 'Invitation not found');
	}

	if (invite.status === 'accepted') {
		redirect(302, '/chat');
	}

	if (invite.status === 'canceled' || invite.status === 'rejected') {
		error(410, 'This invitation is no longer valid');
	}

	if (invite.expiresAt < new Date()) {
		error(410, 'This invitation has expired');
	}

	return {
		invitationId: invite.id,
		orgName: invite.orgName,
		inviterName: invite.inviterName,
		role: invite.role || 'member',
		email: invite.email
	};
};

export const actions: Actions = {
	accept: async ({ params, locals, request }) => {
		if (!locals.user || !locals.session || !locals.auth) {
			redirect(302, '/login');
		}

		try {
			await locals.auth.api.acceptInvitation({
				body: { invitationId: params.id },
				headers: request.headers
			});
		} catch (e) {
			console.error('[Invite] Failed to accept invitation:', e);
			// Fallback: auto-accept in /chat page.server.ts handles pending invitations
		}

		redirect(302, '/chat');
	},

	decline: async ({ params, locals }) => {
		if (!locals.user || !locals.session) {
			redirect(302, '/login');
		}

		const db = locals.db;
		if (!db) error(503, 'Database unavailable');

		// Mark invitation as rejected
		await db
			.update(invitation)
			.set({ status: 'rejected' })
			.where(eq(invitation.id, params.id));

		redirect(302, '/chat');
	}
};

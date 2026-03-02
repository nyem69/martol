import { redirect, error } from '@sveltejs/kit';
import { invitation, organization, user, member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const invitationId = params.id;
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Fetch invitation details (visible to anyone with the link)
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

	const expired = invite.expiresAt < new Date();
	const invalid = invite.status === 'canceled' || invite.status === 'rejected';

	// If logged in, check if already a member → go straight to chat
	if (locals.user && locals.session) {
		if (invite.status === 'accepted') {
			redirect(302, '/chat');
		}

		const [existing] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, invite.orgId), eq(member.userId, locals.user.id)))
			.limit(1);

		if (existing) {
			// Already a member — also mark invitation as accepted to prevent future prompts
			await db
				.update(invitation)
				.set({ status: 'accepted' })
				.where(eq(invitation.id, invitationId));
			redirect(302, '/chat');
		}
	}

	return {
		invitationId: invite.id,
		orgName: invite.orgName,
		inviterName: invite.inviterName,
		role: invite.role || 'member',
		email: invite.email,
		status: invite.status,
		expired,
		invalid,
		loggedIn: !!(locals.user && locals.session)
	};
};

export const actions: Actions = {
	accept: async ({ params, locals, request }) => {
		if (!locals.user || !locals.session || !locals.auth) {
			redirect(302, `/login?redirect=/accept-invitation/${params.id}`);
		}

		try {
			await locals.auth.api.acceptInvitation({
				body: { invitationId: params.id },
				headers: request.headers
			});
		} catch (e) {
			console.error('[Invite] Failed to accept invitation:', e);
		}

		redirect(302, '/chat');
	},

	decline: async ({ params, locals }) => {
		if (!locals.user || !locals.session) {
			redirect(302, `/login?redirect=/accept-invitation/${params.id}`);
		}

		const db = locals.db;
		if (!db) error(503, 'Database unavailable');

		await db
			.update(invitation)
			.set({ status: 'rejected' })
			.where(eq(invitation.id, params.id));

		redirect(302, '/chat');
	}
};

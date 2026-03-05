/**
 * Better Auth Client — Martol
 *
 * Client-side auth utilities for sign in, sign out, session management,
 * two-factor authentication, and passkeys.
 */

import { createAuthClient } from 'better-auth/svelte';
import {
	emailOTPClient,
	organizationClient,
	twoFactorClient
} from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
	baseURL: typeof window !== 'undefined' ? window.location.origin : '',
	plugins: [emailOTPClient(), organizationClient(), twoFactorClient(), passkeyClient()]
});

export const { signIn, signOut, useSession, emailOtp, twoFactor, organization, passkey } = authClient;

/**
 * Better Auth Client — Martol
 *
 * Client-side auth utilities for sign in, sign out, and session management.
 */

import { createAuthClient } from 'better-auth/svelte';
import { emailOTPClient, organizationClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	baseURL: typeof window !== 'undefined' ? window.location.origin : '',
	plugins: [emailOTPClient(), organizationClient()]
});

export const { signIn, signOut, useSession, emailOtp } = authClient;

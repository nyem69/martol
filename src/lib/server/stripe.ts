/**
 * Stripe client factory — created per-request with the secret key from env.
 */

import Stripe from 'stripe';

export function createStripe(secretKey: string): Stripe {
	return new Stripe(secretKey, { apiVersion: '2026-02-25.clover' });
}

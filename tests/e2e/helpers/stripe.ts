import type { Page } from '@playwright/test';

/**
 * Fill the Stripe hosted checkout form with test card details.
 * Expects the page to be on a Stripe Checkout URL.
 *
 * Card: 4242 4242 4242 4242, Exp: 12/31, CVC: 252
 */
export async function fillStripeCheckout(page: Page) {
	// Wait for Stripe checkout to load
	await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

	// Stripe uses iframes — fill the card number
	const cardFrame = page.frameLocator('iframe[name*="__privateStripeFrame"]:first-of-type');

	// Card number
	await cardFrame.getByPlaceholder(/card number/i).fill('4242424242424242');

	// Expiry
	await cardFrame.getByPlaceholder(/mm.*yy/i).fill('1231');

	// CVC
	await cardFrame.getByPlaceholder(/cvc/i).fill('252');

	// Email (if shown — Stripe sometimes asks for it)
	const emailField = page.getByPlaceholder(/email/i);
	if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
		await emailField.fill('test@martol.test');
	}

	// Name on card (if shown)
	const nameField = page.getByPlaceholder(/name on card/i);
	if (await nameField.isVisible({ timeout: 1000 }).catch(() => false)) {
		await nameField.fill('Test User');
	}

	// Submit
	await page.getByRole('button', { name: /pay|subscribe/i }).click();

	// Wait for redirect back to our app
	await page.waitForURL(/localhost/, { timeout: 30_000 });
}

/**
 * Complete a Stripe Checkout Session for subscriptions.
 * Handles the full flow: redirect → fill card → submit → redirect back.
 */
export async function completeStripeCheckout(page: Page, checkoutUrl: string) {
	await page.goto(checkoutUrl);
	await fillStripeCheckout(page);
}

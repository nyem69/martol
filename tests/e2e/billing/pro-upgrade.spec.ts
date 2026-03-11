import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToSettings, clickUpgrade } from '../helpers/settings';
import { fillStripeCheckout } from '../helpers/stripe';

test.describe('Pro Upgrade Flow', () => {
	test('free user can upgrade to Pro via Stripe checkout', async ({ page }) => {
		await loginAs(page, 'free');
		await goToSettings(page);

		// Click upgrade — should redirect to Stripe Checkout
		await clickUpgrade(page);

		// Fill Stripe checkout form
		await fillStripeCheckout(page);

		// Should redirect back to settings with success
		await expect(page).toHaveURL(/settings.*billing=success/);
	});
});

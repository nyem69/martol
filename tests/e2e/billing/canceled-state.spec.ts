import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToSettings } from '../helpers/settings';

test.describe('Canceled Subscription State', () => {
	test('canceled user can still access settings', async ({ page }) => {
		await loginAs(page, 'canceled');
		await goToSettings(page);

		// Page should load without errors
		expect(page.url()).toContain('/settings');
	});

	test('canceled user can re-subscribe via checkout', async ({ page }) => {
		await loginAs(page, 'canceled');

		// Canceled users should be able to start a new checkout
		const response = await page.request.post('/api/billing/checkout', {
			data: { interval: 'monthly' }
		});

		// Should succeed (canceled != active, so checkout allowed)
		expect(response.ok()).toBeTruthy();
		const data = await response.json();
		expect(data.url).toContain('checkout.stripe.com');
	});
});

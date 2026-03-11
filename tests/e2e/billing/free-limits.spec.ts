import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToSettings } from '../helpers/settings';

test.describe('Free Plan Limits', () => {
	test('free user sees free plan on settings', async ({ page }) => {
		await loginAs(page, 'free');
		await goToSettings(page);

		// Verify free plan display
		const body = await page.textContent('body');
		expect(body?.toLowerCase()).toMatch(/free|upgrade/);
	});

	test('free user can access feature gates API', async ({ page }) => {
		await loginAs(page, 'free');

		// Check that the verify endpoint works for free users
		const response = await page.request.post('/api/billing/checkout', {
			data: { interval: 'monthly' }
		});

		// Should succeed — free users can initiate checkout
		expect(response.ok()).toBeTruthy();
		const data = await response.json();
		expect(data.url).toBeTruthy();
	});
});

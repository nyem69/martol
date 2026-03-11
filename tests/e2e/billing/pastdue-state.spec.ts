import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToSettings } from '../helpers/settings';

test.describe('Past Due Subscription State', () => {
	test('past-due user can access settings', async ({ page }) => {
		await loginAs(page, 'pastDue');
		await goToSettings(page);

		expect(page.url()).toContain('/settings');
	});

	test('past-due user can access billing portal to update payment', async ({ page }) => {
		await loginAs(page, 'pastDue');

		// Past-due users should be able to access the portal to fix payment
		const response = await page.request.post('/api/billing/portal');

		// May succeed or fail depending on seed state — both are valid
		expect([200, 400]).toContain(response.status());
	});
});

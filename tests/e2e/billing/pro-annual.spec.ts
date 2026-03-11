import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Pro Annual Upgrade', () => {
	test('checkout API accepts annual interval', async ({ page }) => {
		await loginAs(page, 'free');

		// Call checkout API directly with annual interval
		const response = await page.request.post('/api/billing/checkout', {
			data: { interval: 'annual' }
		});

		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.url).toContain('checkout.stripe.com');
	});
});

import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Team Creation', () => {
	test('user can create team via checkout API', async ({ page }) => {
		await loginAs(page, 'teamOwner');

		// Call team checkout API
		const response = await page.request.post('/api/billing/team/checkout', {
			data: { name: 'E2E Test Team', seats: 5 }
		});

		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.url).toContain('checkout.stripe.com');
	});

	test('rejects empty team name', async ({ page }) => {
		await loginAs(page, 'free');

		const response = await page.request.post('/api/billing/team/checkout', {
			data: { name: '', seats: 5 }
		});

		expect(response.ok()).toBeFalsy();
		expect(response.status()).toBe(400);
	});
});

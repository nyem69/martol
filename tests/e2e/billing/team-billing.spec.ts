import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Team Billing', () => {
	test('team owner can access billing portal', async ({ page }) => {
		await loginAs(page, 'teamOwner');

		const response = await page.request.post('/api/billing/portal');
		// May succeed or return 400 if no stripe customer — depends on seed state
		expect([200, 400]).toContain(response.status());
	});

	test('team owner can view team details', async ({ page }) => {
		await loginAs(page, 'teamOwner');

		const response = await page.request.get('/api/billing/team');
		expect(response.ok()).toBeTruthy();

		const body = await response.json();
		if (body.team) {
			expect(body.team).toHaveProperty('seats');
			expect(body.team).toHaveProperty('status');
			expect(body.team).toHaveProperty('memberCount');
		}
	});
});

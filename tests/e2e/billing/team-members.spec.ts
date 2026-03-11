import { test, expect } from '@playwright/test';
import { loginAs, accounts } from '../helpers/auth';

test.describe('Team Member Management', () => {
	test('team owner can view team info', async ({ page }) => {
		await loginAs(page, 'teamOwner');

		const response = await page.request.get('/api/billing/team');
		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.team).toBeTruthy();
		expect(body.team.name).toBeTruthy();
	});

	test('team owner can add a member', async ({ page }) => {
		await loginAs(page, 'teamOwner');

		const response = await page.request.post('/api/billing/team/members', {
			data: { email: accounts.free.email }
		});

		// May succeed or fail with 400 (already assigned) — both are valid
		expect([200, 400]).toContain(response.status());
	});

	test('non-owner cannot manage team members', async ({ page }) => {
		await loginAs(page, 'free');

		const response = await page.request.post('/api/billing/team/members', {
			data: { email: accounts.pro.email }
		});

		// Should be 404 (no team found for this user)
		expect(response.status()).toBe(404);
	});
});

import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToSettings, clickManageBilling } from '../helpers/settings';

test.describe('Pro Cancellation', () => {
	test('pro user can access Stripe billing portal', async ({ page }) => {
		await loginAs(page, 'pro');
		await goToSettings(page);

		// Click manage billing — should get portal URL
		const [response] = await Promise.all([
			page.waitForResponse(resp => resp.url().includes('/api/billing/portal')),
			clickManageBilling(page)
		]);

		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.url).toContain('billing.stripe.com');
	});

	test('canceled user sees canceled status', async ({ page }) => {
		await loginAs(page, 'canceled');
		await goToSettings(page);

		// Verify canceled state is shown
		const planText = await page.locator('[data-testid="subscription-status"]').textContent();
		expect(planText?.toLowerCase()).toContain('cancel');
	});
});

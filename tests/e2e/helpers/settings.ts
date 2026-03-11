import type { Page } from '@playwright/test';

/**
 * Navigate to the settings/billing page.
 */
export async function goToSettings(page: Page) {
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
}

/**
 * Get the current plan display text from the settings page.
 */
export async function getCurrentPlan(page: Page): Promise<string> {
	const planEl = page.locator('[data-testid="current-plan"]');
	return (await planEl.textContent()) ?? '';
}

/**
 * Click the upgrade button on the settings page.
 */
export async function clickUpgrade(page: Page) {
	await page.getByRole('button', { name: /upgrade/i }).click();
}

/**
 * Click the manage billing button (portal redirect).
 */
export async function clickManageBilling(page: Page) {
	await page.getByRole('button', { name: /manage.*billing/i }).click();
}

/**
 * Click the create team button on the settings page.
 */
export async function clickCreateTeam(page: Page) {
	await page.getByRole('button', { name: /create.*team/i }).click();
}

import type { Page } from '@playwright/test';

/**
 * Login as a test account by calling the test-login endpoint
 * and setting the session cookie on the page context.
 */
export async function login(page: Page, email: string, password: string) {
	const response = await page.request.post('/api/auth/test-login', {
		data: { email, password }
	});

	if (!response.ok()) {
		throw new Error(`Test login failed for ${email}: ${response.status()} ${await response.text()}`);
	}

	return response.json();
}

/** Test account credentials for quick reference */
export const accounts = {
	free: { email: 'test-free@martol.test', password: 'TestFree123!' },
	pro: { email: 'test-pro@martol.test', password: 'TestPro123!' },
	founder: { email: 'test-founder@martol.test', password: 'TestFounder123!' },
	teamOwner: { email: 'test-team-owner@martol.test', password: 'TestTeamOwner123!' },
	teamMember: { email: 'test-team-member@martol.test', password: 'TestMember123!' },
	canceled: { email: 'test-canceled@martol.test', password: 'TestCanceled123!' },
	pastDue: { email: 'test-pastdue@martol.test', password: 'TestPastdue123!' }
} as const;

/** Login as a specific test account type */
export async function loginAs(page: Page, account: keyof typeof accounts) {
	const { email, password } = accounts[account];
	return login(page, email, password);
}

import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000, // Stripe checkout is slow
	retries: 1,
	use: {
		baseURL: 'http://localhost:5190',
		headless: true,
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'pnpm dev',
		port: 5190,
		reuseExistingServer: true,
		timeout: 30_000
	}
});

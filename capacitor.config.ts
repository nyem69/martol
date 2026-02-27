import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'app.martol',
	appName: 'Martol',
	webDir: 'build',
	server: {
		hostname: 'martol.app',
		iosScheme: 'https',
		androidScheme: 'https'
	}
};

export default config;

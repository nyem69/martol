import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isCapacitor = process.env.CAPACITOR === 'true';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: isCapacitor
			? adapterStatic({ pages: 'build', assets: 'build', fallback: 'index.html' })
			: adapterCloudflare({
					routes: {
						include: ['/*'],
						exclude: ['<all>']
					}
				}),
		alias: {
			$components: 'src/lib/components',
			$server: 'src/lib/server'
		},
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': [
					'self',
					'unsafe-inline',
					'https://static.cloudflareinsights.com',
					'https://challenges.cloudflare.com'
				],
				'style-src': ['self', 'unsafe-inline', 'https://cdn.jsdelivr.net'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self', 'data:', 'https://cdn.jsdelivr.net'],
				'connect-src': [
					'self',
					'https://martol.app',
					'wss://martol.app',
					'https://martol.plitix.com',
					'wss://martol.plitix.com',
					'https://cloudflareinsights.com',
					'https://challenges.cloudflare.com'
				],
				'frame-src': ['https://challenges.cloudflare.com'],
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;

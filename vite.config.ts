import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * Strip invalid sourceMappingURL comments from paraglide-generated files.
 * Paraglide emits these comments pointing to non-existent .map files.
 * Uses load hook to intercept before Vite extracts source maps.
 */
function stripParaglideSourcemaps(): Plugin {
	return {
		name: 'strip-paraglide-sourcemaps',
		enforce: 'pre',
		async load(id) {
			if (id.includes('paraglide') && id.endsWith('.js')) {
				const fs = await import('node:fs/promises');
				const code = await fs.readFile(id, 'utf-8');
				const stripped = code.replace(/\/\/# sourceMappingURL=.+\.map$/gm, '');
				return { code: stripped, map: null };
			}
		}
	};
}

export default defineConfig({
	plugins: [
		stripParaglideSourcemaps(),
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	],

	server: {
		port: 5190
	}
});

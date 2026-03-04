import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
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

// Read build number from BUILD_NUMBER file (auto-incremented by pre-commit hook)
const buildNumber = (() => {
	try {
		return readFileSync('BUILD_NUMBER', 'utf-8').trim();
	} catch {
		return '0';
	}
})();

export default defineConfig({
	define: {
		__BUILD_NUMBER__: JSON.stringify(buildNumber)
	},
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

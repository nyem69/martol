/**
 * Theme Store — Martol
 *
 * Manages theme selection with localStorage persistence.
 * Each theme is a complete set of CSS custom properties applied to :root.
 */

export interface ThemeDefinition {
	id: string;
	/** i18n key for the theme name */
	nameKey: string;
	/** Whether this theme is dark or light */
	mode: 'dark' | 'light';
	/** Preview colors for the swatch: [bg, surface, accent, text] */
	preview: [string, string, string, string];
	vars: Record<string, string>;
}

export const THEMES: ThemeDefinition[] = [
	{
		id: 'forge',
		nameKey: 'theme_forge',
		mode: 'dark',
		preview: ['#1e1e24', '#2a2a31', '#c8973a', '#e5e5e8'],
		vars: {
			'--bg': 'oklch(0.15 0.01 260)',
			'--bg-surface': 'oklch(0.19 0.01 260)',
			'--bg-elevated': 'oklch(0.23 0.01 260)',
			'--text': 'oklch(0.92 0.01 260)',
			'--text-muted': 'oklch(0.66 0.01 260)',
			'--accent': 'oklch(0.75 0.15 65)',
			'--accent-hover': 'oklch(0.80 0.15 65)',
			'--accent-muted': 'oklch(0.55 0.10 65)',
			'--border': 'oklch(0.28 0.01 260)',
			'--border-subtle': 'oklch(0.22 0.01 260)',
			'--danger': 'oklch(0.65 0.20 25)',
			'--success': 'oklch(0.70 0.17 145)',
			'--warning': 'oklch(0.75 0.15 65)',
			'--info': 'oklch(0.65 0.12 240)',
			'--bubble-own': 'oklch(0.55 0.10 65)',
			'--bubble-own-text': 'oklch(0.92 0.01 260)'
		}
	},
	{
		id: 'obsidian',
		nameKey: 'theme_obsidian',
		mode: 'dark',
		preview: ['#0a0a0c', '#111114', '#00d4aa', '#d0d0d4'],
		vars: {
			'--bg': 'oklch(0.10 0.005 270)',
			'--bg-surface': 'oklch(0.14 0.005 270)',
			'--bg-elevated': 'oklch(0.18 0.005 270)',
			'--text': 'oklch(0.90 0.005 270)',
			'--text-muted': 'oklch(0.58 0.005 270)',
			'--accent': 'oklch(0.78 0.16 170)',
			'--accent-hover': 'oklch(0.83 0.16 170)',
			'--accent-muted': 'oklch(0.55 0.10 170)',
			'--border': 'oklch(0.22 0.005 270)',
			'--border-subtle': 'oklch(0.17 0.005 270)',
			'--danger': 'oklch(0.65 0.20 25)',
			'--success': 'oklch(0.72 0.17 155)',
			'--warning': 'oklch(0.75 0.15 80)',
			'--info': 'oklch(0.65 0.12 230)',
			'--bubble-own': 'oklch(0.55 0.10 170)',
			'--bubble-own-text': 'oklch(0.90 0.005 270)'
		}
	},
	{
		id: 'parchment',
		nameKey: 'theme_parchment',
		mode: 'light',
		preview: ['#f0ebe3', '#e6e0d5', '#a0522d', '#2c2416'],
		vars: {
			'--bg': 'oklch(0.94 0.015 75)',
			'--bg-surface': 'oklch(0.91 0.015 75)',
			'--bg-elevated': 'oklch(0.96 0.010 75)',
			'--text': 'oklch(0.22 0.02 60)',
			'--text-muted': 'oklch(0.50 0.03 60)',
			'--accent': 'oklch(0.52 0.14 40)',
			'--accent-hover': 'oklch(0.58 0.14 40)',
			'--accent-muted': 'oklch(0.42 0.10 40)',
			'--border': 'oklch(0.82 0.02 75)',
			'--border-subtle': 'oklch(0.87 0.015 75)',
			'--danger': 'oklch(0.55 0.20 25)',
			'--success': 'oklch(0.55 0.15 145)',
			'--warning': 'oklch(0.60 0.15 65)',
			'--info': 'oklch(0.55 0.12 240)',
			'--bubble-own': 'oklch(0.82 0.06 55)',
			'--bubble-own-text': 'oklch(0.25 0.03 40)'
		}
	},
	{
		id: 'neon',
		nameKey: 'theme_neon',
		mode: 'dark',
		preview: ['#0d0d12', '#14141c', '#ff3c8e', '#e0e0e8'],
		vars: {
			'--bg': 'oklch(0.12 0.015 280)',
			'--bg-surface': 'oklch(0.16 0.015 280)',
			'--bg-elevated': 'oklch(0.20 0.015 280)',
			'--text': 'oklch(0.92 0.01 280)',
			'--text-muted': 'oklch(0.62 0.01 280)',
			'--accent': 'oklch(0.68 0.25 350)',
			'--accent-hover': 'oklch(0.74 0.25 350)',
			'--accent-muted': 'oklch(0.50 0.18 350)',
			'--border': 'oklch(0.25 0.015 280)',
			'--border-subtle': 'oklch(0.20 0.015 280)',
			'--danger': 'oklch(0.65 0.22 30)',
			'--success': 'oklch(0.72 0.18 150)',
			'--warning': 'oklch(0.75 0.15 80)',
			'--info': 'oklch(0.68 0.14 250)',
			'--bubble-own': 'oklch(0.50 0.18 350)',
			'--bubble-own-text': 'oklch(0.92 0.01 280)'
		}
	},
	{
		id: 'patina',
		nameKey: 'theme_patina',
		mode: 'dark',
		preview: ['#131a18', '#1a2320', '#5c9e82', '#c8d4ce'],
		vars: {
			'--bg': 'oklch(0.14 0.015 160)',
			'--bg-surface': 'oklch(0.18 0.015 160)',
			'--bg-elevated': 'oklch(0.22 0.015 160)',
			'--text': 'oklch(0.88 0.015 160)',
			'--text-muted': 'oklch(0.60 0.015 160)',
			'--accent': 'oklch(0.65 0.12 160)',
			'--accent-hover': 'oklch(0.72 0.12 160)',
			'--accent-muted': 'oklch(0.48 0.08 160)',
			'--border': 'oklch(0.26 0.015 160)',
			'--border-subtle': 'oklch(0.21 0.015 160)',
			'--danger': 'oklch(0.62 0.18 25)',
			'--success': 'oklch(0.70 0.15 145)',
			'--warning': 'oklch(0.72 0.13 75)',
			'--info': 'oklch(0.62 0.10 220)',
			'--bubble-own': 'oklch(0.48 0.08 160)',
			'--bubble-own-text': 'oklch(0.88 0.015 160)'
		}
	},
	{
		id: 'daybreak',
		nameKey: 'theme_daybreak',
		mode: 'light',
		preview: ['#f5f5f7', '#eaeaee', '#e06030', '#1c1c22'],
		vars: {
			'--bg': 'oklch(0.97 0.005 260)',
			'--bg-surface': 'oklch(0.93 0.005 260)',
			'--bg-elevated': 'oklch(0.99 0.003 260)',
			'--text': 'oklch(0.18 0.01 260)',
			'--text-muted': 'oklch(0.48 0.01 260)',
			'--accent': 'oklch(0.62 0.19 40)',
			'--accent-hover': 'oklch(0.68 0.19 40)',
			'--accent-muted': 'oklch(0.50 0.14 40)',
			'--border': 'oklch(0.86 0.005 260)',
			'--border-subtle': 'oklch(0.90 0.005 260)',
			'--danger': 'oklch(0.58 0.22 25)',
			'--success': 'oklch(0.58 0.16 145)',
			'--warning': 'oklch(0.65 0.16 65)',
			'--info': 'oklch(0.55 0.14 240)',
			'--bubble-own': 'oklch(0.85 0.06 40)',
			'--bubble-own-text': 'oklch(0.25 0.02 40)'
		}
	}
];

const STORAGE_KEY = 'martol-theme';

class ThemeStore {
	current = $state<string>('forge');

	constructor() {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved && THEMES.find((t) => t.id === saved)) {
				this.current = saved;
			}
			this.apply();
		}
	}

	get definition(): ThemeDefinition {
		return THEMES.find((t) => t.id === this.current) ?? THEMES[0];
	}

	get isDark(): boolean {
		return this.definition.mode === 'dark';
	}

	toggleDarkLight() {
		this.set(this.isDark ? 'parchment' : 'forge');
	}

	set(id: string) {
		if (!THEMES.find((t) => t.id === id)) return;
		this.current = id;
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, id);
			this.apply();
		}
	}

	apply() {
		const theme = this.definition;
		const root = document.documentElement;
		for (const [prop, value] of Object.entries(theme.vars)) {
			root.style.setProperty(prop, value);
		}
		root.setAttribute('data-theme', theme.id);
	}
}

export const themeStore = new ThemeStore();

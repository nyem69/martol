import type { Reroute } from '@sveltejs/kit';

// Paraglide i18n reroute — delocalize URLs for routing
export const reroute: Reroute = ({ url }) => {
	// For now with single locale, just return pathname as-is
	// When adding locales, use: deLocalizeUrl(url).pathname
	return url.pathname;
};

// Chat is a WebSocket-driven SPA page — disable SSR to avoid
// DOMPurify/browser-only imports crashing during server rendering.
export const ssr = false;

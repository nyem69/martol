import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
	it('renders bold text', () => {
		const html = renderMarkdown('**hello**');
		expect(html).toContain('<strong>hello</strong>');
	});

	it('renders inline code', () => {
		const html = renderMarkdown('use `console.log`');
		expect(html).toContain('<code>console.log</code>');
	});

	it('renders fenced code blocks', () => {
		const html = renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('<code');
		expect(html).toContain('const x = 1;');
	});

	it('renders links', () => {
		const html = renderMarkdown('[click](https://example.com)');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('click');
	});

	it('adds target=_blank and rel=noopener to links', () => {
		const html = renderMarkdown('[test](https://example.com)');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('sanitizes script tags', () => {
		const html = renderMarkdown('<script>alert("xss")</script>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert');
	});

	it('sanitizes event handlers', () => {
		const html = renderMarkdown('<img onerror="alert(1)" src="x">');
		expect(html).not.toContain('onerror');
	});

	it('renders line breaks (chat-friendly)', () => {
		const html = renderMarkdown('line one\nline two');
		expect(html).toContain('<br');
	});

	it('renders lists', () => {
		const html = renderMarkdown('- item 1\n- item 2');
		expect(html).toContain('<li>');
		expect(html).toContain('item 1');
		expect(html).toContain('item 2');
	});

	it('handles empty string', () => {
		const html = renderMarkdown('');
		expect(html).toBeDefined();
	});
});

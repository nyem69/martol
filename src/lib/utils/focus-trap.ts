/**
 * Focus Trap — traps Tab/Shift+Tab within a container element.
 * Returns a cleanup function to remove the event listener.
 */
export function trapFocus(container: HTMLElement): () => void {
	const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function getFocusable(): HTMLElement[] {
		return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
			.filter((el) => el.offsetParent !== null); // visible only
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const focusable = getFocusable();
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	container.addEventListener('keydown', onKeydown);

	// Focus first focusable element
	const focusable = getFocusable();
	if (focusable.length > 0) focusable[0].focus();

	return () => container.removeEventListener('keydown', onKeydown);
}

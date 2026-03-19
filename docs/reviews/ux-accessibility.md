# UX & Accessibility Review

**Date:** 2026-03-19
**Scope:** All Svelte components under `src/lib/components/`, i18n strings in `messages/en.json`, and related utilities.

---

## Summary

The codebase demonstrates strong accessibility fundamentals: ARIA roles on dialogs, `aria-live` regions for dynamic content, keyboard navigation via `onkeydown` handlers, and focus management on modal open/close. However, there are gaps in focus trapping consistency, hardcoded English strings bypassing i18n, undersized touch targets, and missing semantic attributes in some areas.

**Severity scale:** Critical > High > Medium > Low

---

## 1. Error States

### 1.1 Upload Errors Auto-Dismiss Too Quickly

- **Severity:** Medium
- **Component:** `src/lib/components/chat/ChatInput.svelte` (lines 299-367)
- **Description:** Upload errors dismiss after 4 seconds via `setTimeout`. Users with cognitive disabilities or slow readers may not have time to read the error. The RAG disabled message gets 6 seconds, which is better but still short.
- **Recommendation:** Keep the error visible until the user explicitly dismisses it (the dismiss button already exists), or extend the timeout to at least 10 seconds.

### 1.2 Silent Failures in DocumentPanel

- **Severity:** Medium
- **Component:** `src/lib/components/chat/DocumentPanel.svelte` (lines 73-176)
- **Description:** Multiple `catch { /* silent */ }` blocks in `loadFiles()`, `deleteFile()`, `retryFile()`, `doSearch()`, `loadOcrStatus()`, and `toggleOcr()`. Network failures produce no user feedback.
- **Recommendation:** Set an error state variable and display it in the panel, similar to the `uploadError` pattern in ChatInput.

### 1.3 Report Error Lacks Dismiss Action

- **Severity:** Low
- **Component:** `src/lib/components/chat/ReportModal.svelte` (line 174)
- **Description:** When report submission fails, the error message is shown but there is no retry or dismiss button. The user must close and reopen the modal.
- **Recommendation:** Add a retry button or reset `status` to `idle` so the user can try again.

### 1.4 RAG Config Save Error Not Dismissible

- **Severity:** Low
- **Component:** `src/lib/components/chat/RagConfigModal.svelte` (lines 339-342)
- **Description:** The error alert in the footer has no dismiss action. The user must close and reopen the modal.
- **Recommendation:** Add a dismiss button or clear the error when the user modifies a field.

---

## 2. Loading States

### 2.1 Skeleton Loaders Are Good

- **Severity:** N/A (positive finding)
- **Component:** `src/lib/components/chat/MessageList.svelte` (lines 211-230)
- **Description:** The message list has proper skeleton loaders with `aria-label={m.chat_loading()}` and `aria-busy={loading}` on the log region. This is well implemented.

### 2.2 History Loading Spinner Lacks Screen Reader Text

- **Severity:** Medium
- **Component:** `src/lib/components/chat/MessageList.svelte` (lines 202-208)
- **Description:** The history loading spinner (`loadingHistory`) is a raw `<span>` with CSS animation but no `aria-label` or visually hidden text. Screen readers cannot announce that older messages are being loaded.
- **Recommendation:** Add `aria-label="Loading older messages"` (i18n'd) or use a visually hidden `<span class="sr-only">` next to the spinner.

### 2.3 DocumentPanel Loading Spinner Uses Hardcoded Text

- **Severity:** Low
- **Component:** `src/lib/components/chat/DocumentPanel.svelte` (lines 290-293, 318-321)
- **Description:** "Loading..." and "Searching..." are hardcoded English strings, not passed through paraglide.
- **Recommendation:** Add i18n keys and use `m.chat_loading()` / a new search loading key.

### 2.4 Streaming Cursor Is Accessible

- **Severity:** N/A (positive finding)
- **Component:** `src/lib/components/chat/MessageBubble.svelte` (line 128)
- **Description:** The bubble correctly sets `aria-busy={message.streaming}` and shows `m.chat_streaming()` text. Good.

---

## 3. Accessibility (ARIA)

### 3.1 Focus Trap Missing in Most Modals

- **Severity:** High
- **Component:** Multiple modals
- **Description:** Only `UpgradeModal` and `ImageModal` import `trapFocus` from the utility. The following modals implement inline focus trapping via manual Tab key handling in `onKeydown`, which works but is inconsistent:
  - `BriefModal` -- inline trap (good)
  - `RagConfigModal` -- inline trap (good)
  - `ReportModal` -- inline trap (good)
  - `ConfirmDialog` -- **no focus trap at all** (only Escape handling)
  - `AIDisclosureModal` -- traps Tab to single button only (acceptable given single-action design)
  - `MemberPanel` confirm revoke dialog (line 1090) -- **no focus trap**, Escape only
- **Recommendation:** Add Tab-key trapping to `ConfirmDialog` and the MemberPanel revoke dialog, either inline or via `trapFocus()`.

### 3.2 ConfirmDialog Focuses Confirm Instead of Cancel

- **Severity:** Medium
- **Component:** `src/lib/components/chat/ConfirmDialog.svelte` (line 29)
- **Description:** The comment says "Focus cancel button on open for safety" but the code actually binds and focuses `confirmBtn`. For destructive actions (delete), focusing the confirm button is a foot-gun -- accidental Enter press triggers deletion.
- **Recommendation:** Focus the cancel button instead, or add a distinct `cancelBtn` ref.

### 3.3 Hardcoded aria-label Strings Not Internationalized

- **Severity:** High
- **Component:** Multiple files
- **Description:** The following `aria-label` values are hardcoded English strings instead of using paraglide:
  - `ConfirmDialog.svelte`: `"Close"` (lines 55, 72)
  - `ChatHeader.svelte`: `"Close dropdown"`, `"Close menu"`, `"Rename room"`, `"Documents"` (lines 144, 246, 316, 374)
  - `DocumentPanel.svelte`: `"Close document panel"`, `"Documents"`, `"Close"`, `"Retry"`, `"Download"`, `"Delete"` (lines 237, 252, 266, 363, 373, 385)
  - `OnlineBar.svelte`: `"Online members"` (line 34)
  - `MemberPanel.svelte`: `"Copy"` (lines 810, 880, 956), `"Copy name"` (line 916)
  - `ChatInput.svelte`: `"Clear"` (line 561)
  - `ChatView.svelte`: `"Chat room: {store.roomName}"` (line 324)
- **Recommendation:** Add i18n keys for all these labels and replace with `m.xxx()` calls.

### 3.4 svelte-ignore a11y Comments Are Justified

- **Severity:** N/A (positive finding)
- **Description:** The 5 `svelte-ignore a11y_*` comments found are all reasonable:
  - `MessageList.svelte`: `a11y_no_noninteractive_element_interactions` -- `role="log"` with `onkeydown` for End key is valid a11y pattern, well-explained in comment.
  - `ChatInput.svelte`: `a11y_no_static_element_interactions` -- the `<div>` has `role="region"` and handles drag/drop, which is a valid use case.
  - `MessageBubble.svelte`: `a11y_no_static_element_interactions` -- click handler on the bubble for image/citation clicks. Could use delegated event handling, but acceptable.
  - `ChatHeader.svelte`: `a11y_autofocus` (x2) -- autofocus on rename input and create room input is expected UX.

### 3.5 MemberPanel Revoke Dialog Lacks Focus Management

- **Severity:** Medium
- **Component:** `src/lib/components/chat/MemberPanel.svelte` (lines 1088-1131)
- **Description:** The confirm-revoke dialog has `tabindex="-1"` on the dialog container but does not programmatically focus anything on open. The `confirmBtn` is bound but no `$effect` moves focus to it.
- **Recommendation:** Add an `$effect` to focus the cancel button (or the dialog itself) when `confirmTarget` becomes non-null.

### 3.6 DocumentPanel Lacks Focus Management

- **Severity:** Medium
- **Component:** `src/lib/components/chat/DocumentPanel.svelte`
- **Description:** The document panel is a slide-in `<aside>` with no focus trap and no initial focus management. When opened, focus remains on the trigger button in the header. Keyboard users must Tab through the entire page to reach panel content.
- **Recommendation:** Move focus to the search input or close button when the panel opens, and trap focus within the panel while it is visible.

### 3.7 Message Action Buttons Have Tiny Touch Targets

- **Severity:** Medium
- **Component:** `src/lib/components/chat/MessageBubble.svelte` (lines 240, 250)
- **Description:** Reply and Report buttons use `p-0.5` (2px padding) on a 12px/11px icon, yielding approximately 16x16px interactive area. This is well below the 44x44px WCAG 2.5.8 minimum and Apple HIG recommendation.
- **Recommendation:** On `@media (hover: none)` (touch devices), increase the padding to at least `p-2.5` or add `min-h-[44px] min-w-[44px]`. The existing `@media (hover: none)` rule at line 287 only handles opacity, not size.

### 3.8 Retry Button in MessageBubble Is Tiny

- **Severity:** Medium
- **Component:** `src/lib/components/chat/MessageBubble.svelte` (line 204)
- **Description:** The retry button uses `p-0.5` (2px padding) on an 11px icon. Same touch target concern as above.
- **Recommendation:** Increase padding on touch devices.

---

## 4. i18n Completeness

### 4.1 Hardcoded User-Facing Strings in DocumentPanel

- **Severity:** High
- **Component:** `src/lib/components/chat/DocumentPanel.svelte`
- **Description:** The following visible text is hardcoded in English:
  - `"Documents ({files.length})"` (line 259)
  - `"Search documents..."` placeholder (line 279)
  - `"Loading..."` (line 292)
  - `"Searching..."` (line 320)
  - `"No matching documents"` / `"No documents uploaded yet"` (line 324)
  - `"Search Results ({searchResults.length})"` (line 298)
  - `"Supported for search"` (line 400)
  - `"PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, HTML, JSON, YAML, XML"` (line 403)
  - `"Images -- upload only (no text extraction)"` (line 406)
  - `statusLabel()` function returns: `"Indexed"`, `"Processing..."`, `"Queued"`, `"Failed"`, `"Skipped"` (lines 211-218)
  - `formatTime()` returns `"just now"` (line 193)
  - `"Delete File"` / `"Delete this file? This cannot be undone."` (lines 413-414)
- **Recommendation:** Add i18n keys for all of the above and use paraglide.

### 4.2 Hardcoded Strings in BriefModal

- **Severity:** Medium
- **Component:** `src/lib/components/chat/BriefModal.svelte`
- **Description:**
  - `"No brief yet."` (line 248)
  - `'Click <strong>Edit</strong> to write one, or use <strong>Ask Agent to Fill</strong> below.'` (line 251)
  - `"Edit"` button label (line 195)
  - `"Read"` button label (line 203)
- **Recommendation:** Add i18n keys.

### 4.3 Hardcoded Strings in RagConfigModal

- **Severity:** Low
- **Component:** `src/lib/components/chat/RagConfigModal.svelte`
- **Description:**
  - `"Usage this month"` (line 207)
  - `"(coming soon)"` (line 281)
  - `"gpt-4o-mini"` placeholder (line 252) -- arguably not i18n-relevant
- **Recommendation:** Add i18n keys for at least "Usage this month" and "(coming soon)".

### 4.4 Hardcoded Strings in ConfirmDialog

- **Severity:** Medium
- **Component:** `src/lib/components/chat/ConfirmDialog.svelte`
- **Description:** Default prop values `title = 'Confirm'`, `confirmLabel = 'Delete'`, `cancelLabel = 'Cancel'` are English. While callers typically override these, the defaults should use i18n.
- **Recommendation:** Import paraglide and use `m.xxx()` for defaults, or require callers to always pass localized strings.

### 4.5 `formatRelativeTime` in MessageBubble Uses English

- **Severity:** Low
- **Component:** `src/lib/components/chat/MessageBubble.svelte` (lines 80-89)
- **Description:** Returns `"now"`, `"Xm"`, `"Xh"`, `"Xd"` -- compact abbreviations that are English-only. These are visible timestamps next to every message.
- **Recommendation:** Use `Intl.RelativeTimeFormat` or add i18n keys for time abbreviations.

---

## 5. Mobile / Touch

### 5.1 Safe Area Insets Are Well-Handled

- **Severity:** N/A (positive finding)
- **Description:** `env(safe-area-inset-*)` is used correctly in:
  - `ChatInput.svelte`: bottom padding
  - `ChatHeader.svelte`: top padding
  - `MemberPanel.svelte`: top/bottom padding
  - `DocumentPanel.svelte`: top/bottom padding
  - `app.css`: global left/right padding with `@supports` gate

### 5.2 `@media (hover: none)` Only Used in Two Components

- **Severity:** Low
- **Component:** `src/lib/components/chat/MessageBubble.svelte`, `src/lib/components/chat/ChatHeader.svelte`
- **Description:** The hover-to-reveal pattern for message actions and room rename is correctly adapted for touch via `@media (hover: none)`. However, `DocumentPanel.svelte` file action buttons (retry, download, delete) use `opacity-0 group-hover:opacity-100` (line 356) with **no** `@media (hover: none)` override. On touch devices, these buttons are invisible and unreachable.
- **Recommendation:** Add `@media (hover: none) { opacity: 0.6; }` or similar for the file action buttons, matching the MessageBubble pattern.

### 5.3 Touch Target Sizes Below Minimum

- **Severity:** Medium
- **Components:** Multiple
- **Description:** Several interactive elements fall below the 44x44px minimum recommended for touch:
  - Message reply/report buttons: ~16x16px (`p-0.5` on 12px icon)
  - ConfirmDialog close button: ~18x18px (`p-0.5` on 14px icon)
  - ChatHeader rename button: ~18x18px (`p-0.5`)
  - ReplyPreview cancel button: ~18x18px (`p-0.5`)
  - Document panel action buttons: ~26x26px (`p-1` on 13px icon)
  - MemberPanel agent revoke button: ~18x18px (`p-0.5`)
  - UsernamePrompt dismiss button: ~18x18px (`p-0.5`)
- **Recommendation:** On touch devices, use `min-h-11 min-w-11` (44px) or increase padding. The attach and send buttons in ChatInput already use `h-10 w-10` (40px), which is close to correct.

### 5.4 Textarea font-size Is 16px (Good)

- **Severity:** N/A (positive finding)
- **Component:** `src/lib/components/chat/ChatInput.svelte` (line 554)
- **Description:** The chat textarea uses `font-size: 16px`, which prevents iOS Safari from auto-zooming on focus. Good.

---

## 6. Additional Findings

### 6.1 Skip-to-Content Link Exists

- **Severity:** N/A (positive finding)
- **Component:** `src/routes/+layout.svelte` (line 21)
- **Description:** A skip-to-content link using `m.skip_to_content()` is present. Good.

### 6.2 Color-Only Status Indicators

- **Severity:** Medium
- **Component:** `src/lib/components/chat/DocumentPanel.svelte` (lines 201-218, 345-350)
- **Description:** File processing status uses colored dots only (green for indexed, yellow for pending, red for failed). Users with color vision deficiency may not distinguish them. The text label ("Indexed", "Failed", etc.) is present alongside, which partially mitigates this.
- **Recommendation:** Add an icon (checkmark, spinner, X) in addition to the color dot, similar to how `processing` already uses the `RefreshCw` spinner.

### 6.3 Very Small Font Sizes for Key Information

- **Severity:** Low
- **Component:** Multiple
- **Description:** Several components use `text-[9px]` or `font-size: 9px` for functional text (not just decorative):
  - BriefModal section labels (9px)
  - RagConfigModal field labels (9px)
  - Version badge (9px)
  - MemberPanel readonly hints (9px)
- While this follows the "industrial forge" design aesthetic, 9px is below the WCAG recommended minimum of 12px for body text.
- **Recommendation:** Consider increasing to at least 10px for labels that convey functional meaning, or ensure they are supplemented by larger text nearby.

### 6.4 ConnectionBanner Refresh Buttons Lack aria-label

- **Severity:** Low
- **Component:** `src/lib/components/chat/ConnectionBanner.svelte` (lines 29, 34)
- **Description:** The "Refresh" buttons in the closed/failed connection states lack `aria-label`. The visible text `m.chat_refresh()` provides the label, so this is technically acceptable, but the buttons also use `window.location.reload()` which is a page-level action that should be clearly communicated.
- **Recommendation:** Minor -- acceptable as-is since the button has visible text content.

---

## Priority Ranking

| # | Severity | Issue | Effort |
|---|----------|-------|--------|
| 3.3 | High | Hardcoded aria-label strings (~20 instances) | Medium |
| 4.1 | High | DocumentPanel has ~15 hardcoded English strings | Medium |
| 3.1 | High | ConfirmDialog + MemberPanel revoke dialog lack focus trap | Low |
| 3.2 | Medium | ConfirmDialog focuses confirm instead of cancel | Low |
| 3.5 | Medium | MemberPanel revoke dialog lacks focus management | Low |
| 3.6 | Medium | DocumentPanel lacks focus management on open | Low |
| 3.7 | Medium | Message action buttons are 16x16px (needs 44px on touch) | Medium |
| 5.2 | Low-Med | DocumentPanel file actions invisible on touch devices | Low |
| 5.3 | Medium | Multiple buttons below 44px touch target | Medium |
| 4.2 | Medium | BriefModal hardcoded strings | Low |
| 4.4 | Medium | ConfirmDialog default props in English | Low |
| 1.1 | Medium | Upload errors auto-dismiss in 4s | Low |
| 1.2 | Medium | DocumentPanel silent network failures | Medium |
| 2.2 | Medium | History spinner lacks screen reader text | Low |
| 6.2 | Medium | Color-only status indicators | Low |
| 4.3 | Low | RagConfigModal hardcoded strings | Low |
| 4.5 | Low | Relative time abbreviations are English-only | Medium |
| 6.3 | Low | 9px font sizes for labels | Low |
| 1.3 | Low | Report error lacks retry/dismiss | Low |
| 1.4 | Low | RAG config error not dismissible | Low |

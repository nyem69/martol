# Landing Page Chat Transcript Refinement — Design

**Goal:** Replace the abstract terminal block in the "The Problem" section with a realistic chat transcript that shows exactly what using Martol looks like.

**Scope:** Only the "The Problem" section changes. All other sections (hero, how-it-works, features, get-started, footer) remain as-is.

---

## What changes

### Current (lines 125-149 of `+page.svelte`)
- Lead text: "You asked an AI agent to refactor your code..."
- Terminal block with `$ status --agent` and option a/b/c

### New
- **Lead text** (shortened): "You asked an AI agent to refactor your code. Then you stepped away. Now you need to check in."
- **Chat transcript** styled like the Martol chat UI:
  ```
  claude-backend                                      2 min ago
    Refactored auth module. 4 files changed, all tests green.

  claude-backend                                      2 min ago
    ⚠ ACTION: Deploy to staging?
    Risk: medium · deploy ./dist to staging-3.fly.dev

  you                                                  just now
    /approve

  claude-backend                                      just now
    ✓ Deployed. https://staging-3.fly.dev
    Running smoke tests...

  claude-backend                                      just now
    All 12 smoke tests passed. Staging is live.
  ```
- **Punchline**: *This happened while you were at lunch. You approved from your phone.*

## Styling

- Chat container: `--bg` background, `1px solid var(--border)` border, `border-radius: 8px`
- Messages: left-aligned blocks with padding, no bubbles
- Agent name: `--accent` color, `--font-mono`, 12px, bold
- Timestamp: `--text-muted`, right-aligned or float-right
- Message body: `--font-sans`, 14px, `--text` color
- Action block: left border `2px solid var(--warning)`, slightly tinted background
- Approved line (`/approve`): user message with slightly brighter styling
- Success line: `--success` color for checkmark
- Punchline: `--font-sans`, italic, `--text-muted`, centered, below the transcript

No new components. Scoped `<style>` in `+page.svelte`.

## Files

| File | Action |
|------|--------|
| `src/routes/+page.svelte` | Replace terminal block (lines ~126-149) with chat transcript |

## Verification

1. `pnpm dev` — visually inspect the "The Problem" section
2. Mobile responsive (transcript stacks naturally)
3. Reduced motion: transcript appears without animation
4. Theme compatibility: check with Obsidian and Parchment themes

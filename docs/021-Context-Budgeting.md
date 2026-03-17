# Tiered Context Budgeting

**Date:** 2026-03-17
**Status:** Complete (Phase 1-3)
**Priority:** 3
**Inspired by:** [jinn](https://github.com/lanteanio/jinn) — tiered ESSENTIAL/STANDARD/OPTIONAL system prompt budgeting
**Repo:** martol-client (`/Users/azmi/PROJECTS/LLM/martol-client`)

## Summary

Agent system prompts are currently flat — everything included at full fidelity regardless of size. Large room briefs combined with long conversation history can produce oversized prompts. This feature adds tiered context budgeting: ESSENTIAL content is never reduced, STANDARD content (brief) degrades progressively, and OPTIONAL content (future) is omitted first.

## The Problem

`_build_system_prompt()` in `wrapper.py:201` assembles the prompt on every LLM call, including inside the tool loop (line 362). There are no size guards:
- `self.room_brief` is unbounded JSON from the server
- A large brief + large conversation window can exceed 50K+ characters before user messages
- The prompt is re-submitted 5× in a worst-case tool loop

`doc_search` results are already outside the system prompt (they arrive as tool results with `MAX_TOOL_RESULT_LENGTH = 8000`). This is correct and unchanged.

## Architecture

A single new module `martol_agent/context_budget.py` owns all budgeting logic. `_build_system_prompt()` becomes a thin caller that passes raw materials and receives a final string.

### Tier Assignment

| Tier | Content | Size | Degradation |
|------|---------|------|-------------|
| **ESSENTIAL** | Agent identity, room identity, mention rules, tool descriptions, security rules | ~1,400 chars (fixed) | Never reduced |
| **STANDARD** | Room brief (structured JSON sections) | Variable (up to 8K) | Per-section truncation → stub fallback |
| **OPTIONAL** | Reserved for future (member names, older history) | — | Omitted first |

### Measurement

Character count, not token estimation. Rationale:
- No tokenizer dependency needed
- Chars-per-token for Claude is consistently 3.5–4.5
- `len()` is O(1) with no import cost
- The budget is a soft ceiling, not a hard cut

### Budget Constants

| Constant | Default | Env var | Purpose |
|----------|---------|---------|---------|
| `CONTEXT_BUDGET_CHARS` | 80,000 | `CONTEXT_BUDGET_CHARS` | Total system prompt ceiling |
| `BRIEF_MAX_CHARS` | 8,000 | `BRIEF_MAX_CHARS` | Hard cap on brief section |
| `BRIEF_SECTION_MAX_CHARS` | 1,500 | — | Per-section cap in first degradation step |

### Brief Degradation Ladder

1. **Full render** — structured sections with headings. If `len(result) ≤ brief_max` → use as-is
2. **Per-section truncation** — each section capped at `section_max` chars with ellipsis. Re-measure
3. **Stub fallback** — single line: "Project brief available — call brief_get_active to refresh"

## Component Design

### `martol_agent/context_budget.py` (new)

- `TierLevel` enum: `ESSENTIAL`, `STANDARD`, `OPTIONAL`
- `ContextBudget` dataclass: `total_chars`, `brief_max`, `section_max`
- `render_brief(brief_json, budget) -> tuple[str, TierLevel]` — returns rendered text + tier applied
- `check_budget(prompt, budget) -> tuple[bool, int]` — returns (within_budget, chars_used)
- `measure(text) -> int` — alias for `len()`, isolated for future swap

### `martol_agent/wrapper.py` (modified)

- `AgentWrapper.__init__` gains `context_budget_chars` and `brief_max_chars` params
- `_build_system_prompt()` replaces inline brief rendering with `render_brief()` call
- After assembly: `check_budget()` + `log.warning` if over

### CLI / Env Vars

| Flag | Env var | Default |
|------|---------|---------|
| `--context-budget` | `CONTEXT_BUDGET_CHARS` | 80000 |
| `--brief-max` | `BRIEF_MAX_CHARS` | 8000 |

## Data Flow

```
_generate_response() called
  └─ _build_system_prompt()
       ├─ assemble ESSENTIAL block (~1,400 chars, fixed)
       ├─ render_brief(self.room_brief, self.context_budget)
       │    ├─ parse JSON brief
       │    ├─ full render → measure → ok? return
       │    ├─ per-section truncation → measure → ok? return
       │    └─ stub fallback → return
       ├─ assemble SECURITY block (~350 chars, fixed)
       ├─ check_budget(full_prompt, budget)
       │    └─ log WARNING if over
       └─ return prompt string
```

## Build Sequence

### Phase 1 — Core module ✅

- [x] Create `martol_agent/context_budget.py`
- [x] Define `TierLevel` enum, `ContextBudget` dataclass
- [x] Implement `measure()`, `render_brief()`, `check_budget()`

### Phase 2 — Wire into wrapper ✅

- [x] Add `context_budget` instance to `AgentWrapper.__init__`
- [x] Replace inline brief render in `_build_system_prompt()` with `render_brief()`
- [x] Add `check_budget()` call with `log.warning` when over
- [x] Log tier level when degradation fires

### Phase 3 — CLI exposure ✅

- [x] Add `--context-budget` and `--brief-max` arguments to `main()`
- [x] Update `.env.example` with new variables

### Phase 4 — Validation

- [ ] Unit tests for `render_brief()`: no brief, short, at limit, over (section truncation), way over (stub)
- [ ] Smoke test against a room with a large brief

## Design Decisions

**Why not per-room config?** Would require a new server API + schema change — out of scope for priority 3. Per-agent env var is sufficient.

**Why not LLM summarization?** Adds latency + cost for a secondary API call. Truncation with ellipsis is good enough — agents can call `brief_get_active` for the full text.

**Why not token counting?** Requires a tokenizer dependency. Char count with a 80K default maps to ~18K-23K tokens for the system prompt, well within 200K context.

## Files

### Create

| File | Purpose |
|------|---------|
| `martol-client/martol_agent/context_budget.py` | Budget logic, tier enum, render_brief |

### Modify

| File | Change |
|------|--------|
| `martol-client/martol_agent/wrapper.py` | Wire budget into `_build_system_prompt()`, add constructor params |
| `martol-client/.env.example` | Document new env vars |

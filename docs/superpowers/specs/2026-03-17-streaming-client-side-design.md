# Design: Streaming Agent Responses — Client-Side (martol-client Python)

**Date:** 2026-03-17
**Scope:** Python agent client streaming — WS send methods, provider `stream_chat()`, streaming `_process_response`
**Parent spec:** `docs/019-Streaming-Agent-Responses.md`
**Depends on:** Server-side streaming (already deployed — `stream_start`/`stream_delta`/`stream_end` protocol)
**Repo:** `/Users/azmi/PROJECTS/LLM/martol-client`

## Goal

Update the martol-client Python agent to stream LLM responses as progressive text deltas over WebSocket, so users see live-building message bubbles instead of waiting for the full response.

## Scope

- Add `send_stream_start/delta/end` WS methods to `base_wrapper.py`
- Add `stream_chat()` abstract method to `LLMProvider` ABC
- Implement `stream_chat()` for `AnthropicProvider` and `OpenAICompatProvider`
- Replace `_generate_response` / `_process_response` with streaming-aware versions in `wrapper.py`
- `claude_code_wrapper.py` and `codex_wrapper.py` are **out of scope** (they use different execution models)

## Design

### 1. New WS Send Methods — `base_wrapper.py`

Three new async methods alongside existing `send_message()` (line 535):

**`send_stream_start(local_id, reply_to=None)`**
- Sends `{"type": "stream_start", "localId": local_id, "replyTo": reply_to}` over `self.ws`
- Same error handling as `send_message()` (try/except, log, return bool)

**`send_stream_delta(local_id, delta)`**
- Sends `{"type": "stream_delta", "localId": local_id, "delta": delta}`
- No size check (DO enforces 4KB limit per delta, 32KB total)
- Silent failure on error (delta loss is non-fatal)

**`send_stream_end(local_id, body)`**
- Sends `{"type": "stream_end", "localId": local_id, "body": body}`
- Client-side 32KB size check (same as `send_message`)
- This is the canonical final text that the DO commits to WAL

`send_message()` stays unchanged — used for non-streaming messages (disclosure, error fallback).

### 2. `stream_chat()` on LLMProvider ABC — `providers/__init__.py`

New abstract method:

```python
from collections.abc import AsyncIterator

@abstractmethod
async def stream_chat(
    self,
    system: str,
    messages: list[dict],
    tools: list[dict],
) -> AsyncIterator[str | LLMResponse]:
    """Stream a chat response. Yields str deltas, then a final LLMResponse."""
    ...
```

Import `AsyncIterator` from `collections.abc` (Python 3.10+). The actual implementation is an `AsyncGenerator` (uses `yield`), but `AsyncIterator` is the correct public return type annotation.

The iterator yields:
- `str` — text deltas (0 or more)
- `LLMResponse` — final item, carries `tool_calls` and `stop_reason`

The existing `chat()` method stays unchanged for tool-result follow-up turns.

### 3. Anthropic `stream_chat()` — `providers/anthropic.py`

```python
async def stream_chat(self, system, messages, tools):
    kwargs = { model, max_tokens, system, messages, tools }
    async with self.client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text
        response = await stream.get_final_message()
        yield self._parse_response(response)
```

Uses the Anthropic SDK's `messages.stream()` context manager which:
- Provides `.text_stream` async iterator for text deltas
- Provides `.get_final_message()` for the complete response including tool_use blocks

### 4. OpenAI `stream_chat()` — `providers/openai_compat.py`

```python
async def stream_chat(self, system, messages, tools):
    openai_messages = [{"role": "system", "content": system}]
    openai_messages.extend(messages)
    kwargs = {
        "model": self.model,
        "messages": openai_messages,
        "max_tokens": 4096,
        "stream": True,
    }
    openai_tools = to_openai_tools(tools)
    if openai_tools:
        kwargs["tools"] = openai_tools

    response = await self.client.chat.completions.create(**kwargs)

    text_parts: list[str] = []
    # Accumulate tool call fragments keyed by index
    # Each entry: {"id": str, "name": str, "arguments": str}
    tool_calls_acc: dict[int, dict[str, str]] = {}
    finish_reason: str | None = None

    async for chunk in response:
        choice = chunk.choices[0] if chunk.choices else None
        if not choice:
            continue
        delta = choice.delta

        # Text deltas — yield immediately
        if delta.content:
            yield delta.content
            text_parts.append(delta.content)

        # Tool call fragments — accumulate by index
        if delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_calls_acc:
                    tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                entry = tool_calls_acc[idx]
                if tc_delta.id:
                    entry["id"] = tc_delta.id
                if tc_delta.function and tc_delta.function.name:
                    entry["name"] = tc_delta.function.name
                if tc_delta.function and tc_delta.function.arguments:
                    entry["arguments"] += tc_delta.function.arguments

        if choice.finish_reason:
            finish_reason = choice.finish_reason

    # Assemble final LLMResponse
    assembled_tool_calls = []
    for idx in sorted(tool_calls_acc.keys()):
        entry = tool_calls_acc[idx]
        try:
            args = json.loads(entry["arguments"]) if entry["arguments"] else {}
        except json.JSONDecodeError:
            args = {}
        assembled_tool_calls.append(ToolCall(id=entry["id"], name=entry["name"], arguments=args))

    stop_map = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens"}
    yield LLMResponse(
        text="".join(text_parts) or None,
        tool_calls=assembled_tool_calls,
        stop_reason=stop_map.get(finish_reason or "", "end_turn"),
    )
```

OpenAI streams tool call arguments as fragments across multiple chunks. The `tool_calls_acc` dict accumulates fragments keyed by `tc_delta.index` — `id` and `function.name` arrive on the first chunk for each index, `function.arguments` arrive as string fragments across subsequent chunks. The final assembly parses the concatenated arguments JSON and builds `ToolCall` objects.

### 5. Streaming `_generate_response` — `wrapper.py`

Replace the current `_generate_response` (line 164) and `_process_response` (line 315) with a single streaming-aware flow:

```python
async def _generate_response(self, payload: dict) -> None:
    async with self._responding:
        if not self.llm_limiter.allow():
            return

        system = self._build_system_prompt()
        messages = self._build_llm_messages()
        trigger_seq_id = payload.get("serverSeqId") or payload.get("id")

        iteration = 0
        while iteration < MAX_TOOL_ITERATIONS:
            if not self.ws or self.ws.closed:
                break

            local_id = uuid4().hex
            full_body = ""
            response = None

            # Stream this turn
            await self.send_stream_start(local_id, reply_to=trigger_seq_id if iteration == 0 else None)

            try:
                async for chunk in self.provider.stream_chat(system, messages, TOOLS):
                    if isinstance(chunk, str):
                        full_body += chunk
                        await self.send_stream_delta(local_id, chunk)
                    elif isinstance(chunk, LLMResponse):
                        response = chunk
            except Exception as e:
                log.error("LLM streaming error: %s", e)

            # Commit whatever was generated
            if full_body.strip():
                await self.send_stream_end(local_id, full_body.strip())
                # Append to conversation context (same dict format as _append_context_from_ws)
                self._append_context({
                    "sender_id": self._agent_user_id,
                    "sender_name": self._agent_name,
                    "sender_role": "agent",
                    "body": full_body.strip(),
                })
            else:
                # No text generated (tool-only response) — send empty stream_end to close cleanly
                # (avoids 2-minute timeout leak on the DO's activeStreams)
                await self.send_stream_end(local_id, "")

            # Exit if no tool calls
            if not response or not response.tool_calls:
                break

            # Execute tools via MCP (no streaming needed)
            tool_results = []
            for tc in response.tool_calls:
                clean_args = _validate_tool_args(tc.name, tc.arguments)
                result = await self._mcp_call(tc.name, clean_args)
                tool_results.append({"tool_call": tc, "result": result})
                # Preserve brief_update side-effect (from old _process_response)
                if tc.name == "brief_update" and result and result.get("ok"):
                    self.room_brief = result.get("brief", self.room_brief)
                    self.room_brief_version = result.get("version", self.room_brief_version)

            # Build follow-up messages for next turn
            follow_up = self._build_tool_result_messages(response, tool_results)
            if not follow_up:
                break

            messages = self._build_llm_messages()
            messages.extend(follow_up)
            iteration += 1
```

**Key behaviors:**
- Each tool loop iteration is a separate stream (new `local_id`, new `stream_start/end`)
- `reply_to` only set on the first turn (subsequent turns are independent messages)
- `send_typing()` calls removed — `stream_start` replaces typing indicator
- On error mid-stream, commit whatever was generated (partial response is better than nothing)
- Empty streams (LLM produced no text, only tool calls) skip `send_stream_end`
- `_build_tool_result_messages()` and `_build_llm_messages()` unchanged
- `_process_response()` removed (replaced by the inline loop). Tests in `tests/test_wrapper.py` that call `_process_response` directly must be rewritten to test the new streaming `_generate_response` instead

### 6. Backwards Compatibility

- `send_message()` stays for: disclosure messages (`_send_disclosure`), error messages, non-streaming wrappers (`claude_code_wrapper.py`, `codex_wrapper.py`)
- `chat()` stays for: any caller that doesn't need streaming
- The `--no-stream` CLI flag is NOT added (streaming is always on for `wrapper.py`)
- `claude_code_wrapper.py` continues using its own `receive_response()` pattern — out of scope

### 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| LLM API error mid-stream | Commit partial body via `send_stream_end`, log error, break loop |
| WS disconnected mid-stream | DO aborts stream on its side; agent reconnects normally |
| Empty LLM response (only tool_use) | Send `send_stream_end` with empty body to close stream cleanly; proceed to tool execution |
| Tool execution fails | Log error, break loop (same as current behavior) |
| Rate limit exceeded | Skip entirely (same as current) |

## Files

### Modify

| File | Change |
|------|--------|
| `martol_agent/base_wrapper.py` | Add `send_stream_start`, `send_stream_delta`, `send_stream_end` |
| `martol_agent/providers/__init__.py` | Add `stream_chat()` to `LLMProvider` ABC, import `AsyncIterator` |
| `martol_agent/providers/anthropic.py` | Implement `stream_chat()` using `messages.stream()` |
| `martol_agent/providers/openai_compat.py` | Implement `stream_chat()` using `stream=True` |
| `martol_agent/wrapper.py` | Rewrite `_generate_response` with streaming loop, remove `_process_response` |
| `tests/test_wrapper.py` | Rewrite tests that called `_process_response` to test streaming `_generate_response` |

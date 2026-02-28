#!/usr/bin/env python3
"""
Martol Agent Wrapper — connects an AI agent to a chat room via WebSocket + API key.

Usage:
    python wrapper.py --url wss://martol.plitix.com/api/rooms/<roomId>/ws --api-key <key>

Environment variables (alternative to flags):
    MARTOL_WS_URL    — WebSocket URL
    MARTOL_API_KEY   — API key for authentication

The wrapper:
1. Connects to the room via WebSocket with API key auth
2. Listens for messages mentioning the agent
3. Forwards relevant messages to the AI provider (via MCP or direct API)
4. Sends responses back to the chat room
"""

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
from typing import Any

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:
    print("Error: websockets package required. Install with: pip install websockets")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("martol-agent")

# ── Configuration ────────────────────────────────────────────────────

MAX_RECONNECT_DELAY = 30
BASE_RECONNECT_DELAY = 1
MAX_RECONNECT_ATTEMPTS = 20


class AgentWrapper:
    """Connects to a Martol chat room and relays messages."""

    def __init__(self, ws_url: str, api_key: str):
        self.ws_url = ws_url
        self.api_key = api_key
        self.ws: WebSocketClientProtocol | None = None
        self.last_known_id = 0
        self.running = True
        self.agent_name: str | None = None

    async def connect(self) -> None:
        """Connect with exponential backoff reconnection."""
        attempt = 0

        while self.running and attempt < MAX_RECONNECT_ATTEMPTS:
            try:
                url = f"{self.ws_url}?lastKnownId={self.last_known_id}"
                headers = {"x-api-key": self.api_key}

                log.info("Connecting to %s (attempt %d)...", self.ws_url, attempt + 1)
                async with websockets.connect(url, additional_headers=headers) as ws:
                    self.ws = ws
                    attempt = 0  # Reset on successful connection
                    log.info("Connected to room")
                    await self._listen(ws)

            except websockets.ConnectionClosed as e:
                if e.code == 4001:
                    log.error("API key revoked (4001). Stopping.")
                    self.running = False
                    return
                log.warning("Connection closed: %s. Reconnecting...", e)
            except (ConnectionRefusedError, OSError) as e:
                log.warning("Connection failed: %s. Reconnecting...", e)
            except Exception as e:
                log.error("Unexpected error: %s", e, exc_info=True)

            if not self.running:
                break

            attempt += 1
            delay = min(BASE_RECONNECT_DELAY * (2 ** (attempt - 1)), MAX_RECONNECT_DELAY)
            log.info("Reconnecting in %.1fs...", delay)
            await asyncio.sleep(delay)

        if attempt >= MAX_RECONNECT_ATTEMPTS:
            log.error("Max reconnect attempts reached. Stopping.")

    async def _listen(self, ws: WebSocketClientProtocol) -> None:
        """Listen for incoming messages."""
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                log.warning("Received non-JSON message, ignoring")
                continue

            await self._handle_message(msg)

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        """Handle a server message."""
        msg_type = msg.get("type")

        if msg_type == "message":
            payload = msg.get("message", {})
            seq_id = payload.get("serverSeqId", 0)
            if seq_id > self.last_known_id:
                self.last_known_id = seq_id

            sender = payload.get("senderName", "unknown")
            body = payload.get("body", "")
            role = payload.get("senderRole", "")
            log.info("[%s/%s] %s", sender, role, body[:120])

            # TODO: Forward to AI provider and respond
            # This is where you'd integrate with Claude, GPT, etc.

        elif msg_type == "history":
            messages = msg.get("messages", [])
            for m in messages:
                seq_id = m.get("serverSeqId", 0)
                if seq_id > self.last_known_id:
                    self.last_known_id = seq_id
            log.info("Received %d history messages", len(messages))

        elif msg_type == "id_map":
            mappings = msg.get("mappings", [])
            log.debug("ID mappings: %s", mappings)

        elif msg_type == "typing":
            pass  # Ignore typing indicators

        elif msg_type == "presence":
            name = msg.get("senderName", "")
            status = msg.get("status", "")
            log.info("Presence: %s is %s", name, status)

        elif msg_type == "error":
            code = msg.get("code", "")
            message = msg.get("message", "")
            log.error("Server error [%s]: %s", code, message)

    async def send_message(self, body: str, reply_to: int | None = None) -> bool:
        """Send a chat message."""
        if not self.ws:
            log.warning("Not connected, cannot send")
            return False

        import uuid
        local_id = uuid.uuid4().hex

        payload: dict[str, Any] = {
            "type": "message",
            "body": body,
            "localId": local_id,
        }
        if reply_to is not None:
            payload["replyTo"] = reply_to

        try:
            await self.ws.send(json.dumps(payload))
            log.info("Sent message: %s", body[:80])
            return True
        except Exception as e:
            log.error("Failed to send: %s", e)
            return False

    async def send_typing(self, active: bool = True) -> None:
        """Send typing indicator."""
        if not self.ws:
            return
        try:
            await self.ws.send(json.dumps({"type": "typing", "active": active}))
        except Exception:
            pass

    def stop(self) -> None:
        """Gracefully stop the wrapper."""
        log.info("Stopping agent wrapper...")
        self.running = False


async def main() -> None:
    parser = argparse.ArgumentParser(description="Martol Agent Wrapper")
    parser.add_argument("--url", default=os.environ.get("MARTOL_WS_URL"), help="WebSocket URL")
    parser.add_argument("--api-key", default=os.environ.get("MARTOL_API_KEY"), help="API key")
    args = parser.parse_args()

    ws_url = args.url
    api_key = args.api_key

    if not ws_url:
        print("Error: WebSocket URL required (--url or MARTOL_WS_URL)")
        sys.exit(1)
    if not api_key:
        print("Error: API key required (--api-key or MARTOL_API_KEY)")
        sys.exit(1)

    wrapper = AgentWrapper(ws_url, api_key)

    # Handle graceful shutdown
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, wrapper.stop)

    await wrapper.connect()


if __name__ == "__main__":
    asyncio.run(main())

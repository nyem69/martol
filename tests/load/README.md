# Load Tests (k6)

Performance and load testing scripts for Martol using [k6](https://k6.io/).

## Prerequisites

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Scripts

| Script | Description | Key Metrics |
|---|---|---|
| `http-endpoints.js` | REST API: landing, auth, OTP, upload | p95 < 500ms |
| `websocket-rooms.js` | WebSocket: 100 VUs, 10 rooms | p95 < 200ms |
| `mcp-endpoint.js` | MCP: 60 VUs with API keys | p95 < 500ms |

## Running

```bash
# HTTP endpoints (no auth needed)
k6 run tests/load/http-endpoints.js

# Custom base URL
BASE_URL=http://localhost:8787 k6 run tests/load/http-endpoints.js

# WebSocket (requires API key + room IDs)
API_KEY=mart_... ROOM_0=org-id-here k6 run tests/load/websocket-rooms.js

# MCP (requires API key)
API_KEY=mart_... k6 run tests/load/mcp-endpoint.js
```

## Thresholds

- HTTP REST: p95 < 500ms, error rate < 5%
- WebSocket message delivery: p95 < 200ms
- MCP: p95 < 500ms, error rate < 10%

## Notes

- k6 is a Go binary — it's not an npm package
- These tests hit the actual deployment; don't run against production without coordination
- WebSocket and MCP tests require valid API keys with room access
- Rate limiting will kick in during tests — this is expected and verifiable

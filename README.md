# React Grab Agent Workflow

Lean React Grab fork for extension-based agent feedback capture.

This repo contains only the pieces needed for the current workflow:

- `packages/react-grab`: React Grab core UI with comment queue, structured element context, send-feedback status UI, and extension-only feedback bridge.
- `apps/web-extension`: Chrome MV3 extension that injects React Grab, captures the selected tab screenshot, and posts feedback to an agent endpoint.
- `scripts/mock-agent-endpoint.mjs`: local mock receiver that logs payloads, crops screenshots to the selected element, and simulates agent status.

## Build

```bash
pnpm install
pnpm build
```

The unpacked Chrome extension is built at:

```text
apps/web-extension/dist
```

## Run Mock Receiver

```bash
pnpm mock:agent-endpoint --port 8787
```

The receiver handles:

- `POST /__react-grab-agent-feedback`
- `GET /__react-grab-agent-feedback/:jobId`

Logs are written to `logs/react-grab-feedback.jsonl`; cropped screenshots are written under `logs/screenshots/`.

## Configure Endpoint

The extension reads the receiver base URL from Chrome storage key:

```text
react_grab_agent_endpoint
```

If unset, it defaults to:

```text
http://localhost:8787
```

For a remote sandbox receiver, set that storage value to the exposed receiver URL.

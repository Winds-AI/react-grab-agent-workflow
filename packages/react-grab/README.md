# React Grab

Local React Grab package used by the Chrome extension in this repo.

This fork adds:

- comment queue feedback flow
- structured page, viewport, DOM, source, and bounds context
- extension-only feedback transport
- separated `userFeedback` and generated element context
- agent status UI for `starting`, `working`, `completed`, and `failed`

Build this package before rebuilding the extension:

```bash
pnpm --filter react-grab build
```

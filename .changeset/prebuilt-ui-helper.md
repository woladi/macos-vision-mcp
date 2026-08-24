---
"macos-vision-mcp": patch
---

fix: use the prebuilt ui-helper from macos-vision instead of compiling one

The UI tools shipped in 0.5.0 compiled their own copy of `ui-helper` with
`swiftc` on first use, so on any Mac without Xcode Command Line Tools all five
of them failed mid-session with `spawn swiftc ENOENT` — while a perfectly good
prebuilt binary was already sitting in `node_modules/macos-vision/bin/`.

Capture, window and display introspection, and permission checks now come from
`macos-vision` ≥ 1.6.0, which owns the native-helper pipeline and ships
`ui-helper` alongside `vision-helper` and `pdf-helper`. This server keeps only
what is specific to serving them as MCP tools: source resolution, text
normalization and element matching. `src/ui.ts` drops from 421 to 196 lines and
the published package no longer carries Swift source.

`vision_capabilities` additionally reports the Vision feature flags and OCR
language count from the library, and no longer spawns `sw_vers`.

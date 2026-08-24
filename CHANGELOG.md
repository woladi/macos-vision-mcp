# Changelog

## 0.6.0

### Minor Changes

- 0451899: feat: `ui_snapshot` — the whole layout as JSON, not just the text

  Where `find_element` answers "where is X", `ui_snapshot` answers "what is on this
  screen": every element's box, role, label and enabled state from the macOS
  accessibility API, the parent/child structure, optionally colours sampled from
  the capture and real font data — plus the visible text the tree does not account
  for.

  Geometry here is measured rather than inferred from OCR, so it is exact and
  covers elements with no text at all. `unresolved` completes the picture where AX
  is blind (canvas, WebGL, games, text baked into images) and doubles as an
  accessibility finding.

  The tool description tells the model how to read the output honestly:
  `budget.capped` means the tree is incomplete, `summary.axTextCoverage` is null in
  that case rather than a figure that would blame the app for our budget, colours
  are unreliable for occluded elements, and `borderWidth` is inferred — this is not
  the CSS box model.

## 0.5.1

### Patch Changes

- a486e92: fix: use the prebuilt ui-helper from macos-vision instead of compiling one

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

## 0.5.0

### Minor Changes

- d35dce0: feat: local UI-testing tools — `vision_capabilities`, `list_windows`, `capture_screen`, `read_screen_text`, `find_element`, `assert_text`

  An agent can now see and verify macOS UI without sending a screenshot to a cloud model: capture happens locally, OCR runs on-device, and only paths, geometry and extracted text leave the module. `find_element` returns a whole-pixel `clickPoint` in global screen points, ready for any input driver — this server deliberately does not click. A locked screen is detected and reported outright instead of surfacing as an opaque capture failure.

  Also raises the `macos-vision` dependency to ^1.6.0, which carries the `ui-helper` binary as a prebuilt; the interim `swiftc`-on-first-use compile stays for now (see docs/PLAN-ui-testing-vision.md).

## 0.4.9 (2026-06-17)

## 0.4.8 (2026-06-17)

## 0.4.7 (2026-06-16)

## 0.4.6 (2026-06-04)

## 0.4.5 (2026-06-04)

## 0.4.4 (2026-06-04)

## 0.4.3 (2026-06-04)

## 0.4.2 (2026-05-09)

### Bug Fixes

- read McpServer version from package.json at runtime ([7b4703b](https://github.com/woladi/macos-vision-mcp/commit/7b4703b5ef3b77b487f7c654965394b5966d02c9))

## 0.4.1 (2026-05-09)

## 0.4.0 (2026-05-09)

### Features

- structured JSON output for document reconstruction ([c00fa42](https://github.com/woladi/macos-vision-mcp/commit/c00fa42fe9f8faa033cd22dfc50d1fec9f0676e0))

## 0.2.7 (2026-05-08)

### Bug Fixes

- upgrade npm to latest for OIDC trusted publishing support ([b1b1cb5](https://github.com/woladi/macos-vision-mcp/commit/b1b1cb58675dd2af0427f8427f5b80391032e2a5))

## 0.2.6 (2026-05-08)

## 0.2.5 (2026-05-08)

## 0.2.4 (2026-05-08)

### Bug Fixes

- split release-it and npm publish for OIDC trusted publishing ([6e217c5](https://github.com/woladi/macos-vision-mcp/commit/6e217c582b85a600089d085981ddb5aa93bb757a))

## [0.2.3](https://github.com/woladi/macos-vision-mcp/compare/v0.2.1...v0.2.3) (2026-04-10)

## [0.2.1](https://github.com/woladi/macos-vision-mcp/compare/v0.2.0...v0.2.1) (2026-04-09)

## 0.2.0 (2026-04-09)

### Features

- initial release ([8b0d9e3](https://github.com/woladi/macos-vision-mcp/commit/8b0d9e33e58e49753a2a1e525714bb16ee7320e2))

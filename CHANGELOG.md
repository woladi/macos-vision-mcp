# Changelog

## 0.6.7

### Patch Changes

- 65e91e9: feat: a logo — viewfinder brackets locked onto an eye

  Violet brackets, a red iris, a black pupil with a crosshair on it. The mark is
  authored as SVG rather than kept as the generated raster: the image model returns
  JPEG, and its compression smears colour across every edge — a histogram of the
  source still held leftover chroma-key green and brown edge artefacts, which is
  disqualifying for something that has to stay sharp at 20px.

  The geometry was measured off the reference pixel by pixel and rebuilt with fills
  only, arc flags written out in full, because some renderers silently drop stroked
  paths and others reject the compact flag shorthand — either failure would reduce
  the mark to a bare disc.

  Violet is always the outermost shape, so the silhouette holds on a white page and
  on GitHub's dark theme alike. The black pupil does recede into a dark background;
  that is deliberate, and the alternative that keeps it distinct on both is one
  colour value away if it ever grates.

  Ships as `logo.svg` plus PNG exports at 512/256/128/64/32, wired into the README
  and into `server.json`'s `icons` field so MCP clients and directories can render
  it.

## 0.6.6

### Patch Changes

- f94f4af: docs: keywords and descriptions that mention the half of this tool they were omitting

  The npm keywords were entirely OCR and documents — nothing about screen reading,
  UI work, accessibility or agents — and both one-line descriptions, the one npm
  shows in search results and the one the MCP registry lists, described an OCR
  server only.

  Adds `computer-use`, `ui-automation`, `ui-testing`, `desktop-automation`,
  `accessibility`, `ai-agent`, `screen-capture`, `on-device` and `privacy`,
  keeping every existing keyword: the document terms are what brings traffic today
  and nothing is served by dropping them.

  Both descriptions now name both halves. The registry one stays within the
  schema's 100-character limit.

## 0.6.5

### Patch Changes

- c9635d1: docs: add a "What agents use this for" chapter

  The README framed everything as UI testing, which undersold the tool. Most work
  an agent does on a Mac needs no understanding of a layout at all — it needs to
  see the screen, find a thing, act on it, and confirm what happened, and three of
  the light tools serve exactly that. Driving an app with no API, reading a dialog
  in a background window, pulling data out of software that will not export it, and
  auditing accessibility are all first-class uses; UI testing is one entry on that
  list rather than the frame around it.

  The chapter also states plainly why doing this locally is better rather than
  merely different — ~29× cheaper per step, no screenshot of whatever else was on
  screen leaving the machine, and no network term in the latency — and what the
  server deliberately does not do, which is click.

  Removes the duplicate argument that had grown in the UI-testing chapter; that
  section now carries the measurements as evidence rather than repeating the case.

## 0.6.4

### Patch Changes

- 6897b34: docs: correct the 0.6.3 changelog claim about npm and relative images

  0.6.3 claimed the old relative image path meant npm showed no image at all. That
  was wrong. The check behind it was grepping the npm package page's HTML, which is
  client-rendered and carries no README markup — so it could not have found an
  image whether or not one rendered.

  Verified properly in a browser afterwards: npm rewrites a relative path to
  `raw.githubusercontent.com/<repo>/HEAD/…` and the previous hero did load on the
  package page. The switch to absolute URLs is still worthwhile — it pins each
  image to `master` rather than floating on `HEAD` — but it repaired nothing that
  was broken, and the changelog now says so.

## 0.6.3

### Patch Changes

- 5338de7: docs: three illustrations that tell the whole story, and images that work on npm

  The previous hero showed document OCR only — nothing about UI testing, which is
  now half of what this does — and carried the usual generative-art artefacts in
  its lettering ("Darccooe", "OR/Barcoo-ment").

  Three new illustrations, each anchoring the section it belongs to: the privacy
  boundary at the top, the accessibility inspector where UI testing is introduced,
  and the token-cost contrast where the cost claim is made. Each carries a caption
  so the picture states the point rather than decorating it.

  They also use absolute URLs, which pin each image to `master` rather than
  relying on npm's own rewriting.

  > **Correction (0.6.4).** This entry originally claimed that the old relative
  > path meant npm showed no image at all. That was wrong, and was based on
  > grepping the npm page's HTML — which is client-rendered and contains no
  > README markup, so the check could not have shown an image either way.
  > Checked properly in a browser afterwards: npm does rewrite a relative path,
  > to `raw.githubusercontent.com/<repo>/HEAD/…`, and the old hero did load.
  > Absolute URLs are still worth having — they pin to a branch instead of
  > floating on `HEAD` — but they fixed nothing that was broken.

## 0.6.2

### Patch Changes

- 5b45832: docs: the capabilities resource describes the UI tools, which it had been omitting

  The `macos-vision://capabilities` resource is what a model reads to learn what
  this server does, and it still listed only the six document tools. All seven UI
  tools were invisible there — a model consulting it would conclude that screen
  capture, element location, assertions and `ui_snapshot` do not exist.

  It now describes them, along with the permissions they need (Screen Recording,
  plus Accessibility for `ui_snapshot`) and the fact that a locked Mac exposes no
  accessibility windows at all — with `screenLocked` available to check that up
  front rather than infer it from a failure.

  Also corrects the install note: four prebuilt helpers ship now, not three, and
  the download is ~276 KB compressed.

## 0.6.1

### Patch Changes

- 76f3e71: fix: pick up macos-vision 1.8.2, which stops inventing colours for tiny elements

  `ui_snapshot` reported `bg: #000000` for 1×1 pt screen-reader anchors — the fill
  was sampled from outside the element, which reads as a black element that is not
  there. Fixed upstream; this pulls it in.

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

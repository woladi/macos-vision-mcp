---
"macos-vision-mcp": minor
---

feat: `ui_snapshot` — the whole layout as JSON, not just the text

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

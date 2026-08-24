---
"macos-vision-mcp": patch
---

feat: a logo — viewfinder brackets locked onto an eye

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

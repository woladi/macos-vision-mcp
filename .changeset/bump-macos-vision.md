---
"macos-vision-mcp": patch
---

fix: pick up macos-vision 1.8.2, which stops inventing colours for tiny elements

`ui_snapshot` reported `bg: #000000` for 1×1 pt screen-reader anchors — the fill
was sampled from outside the element, which reads as a black element that is not
there. Fixed upstream; this pulls it in.

---
"macos-vision-mcp": patch
---

docs: three illustrations that tell the whole story, and images that work on npm

The previous hero showed document OCR only — nothing about UI testing, which is
now half of what this does — and carried the usual generative-art artefacts in
its lettering ("Darccooe", "OR/Barcoo-ment").

Three new illustrations, each anchoring the section it belongs to: the privacy
boundary at the top, the accessibility inspector where UI testing is introduced,
and the token-cost contrast where the cost claim is made. Each carries a caption
so the picture states the point rather than decorating it.

They also use absolute URLs. The old relative path meant **npm showed no image at
all** — the package page never resolved `.github/assets/`, so every reader
arriving from npm saw an unillustrated README.

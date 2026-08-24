---
"macos-vision-mcp": patch
---

docs: the capabilities resource describes the UI tools, which it had been omitting

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

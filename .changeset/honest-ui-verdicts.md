---
"macos-vision-mcp": minor
---

Fix four defects in the UI-testing tools, found by running them against a real screen.

**`assert_text` decided verdicts on evidence it should have rejected.** A mid-word substring
counted as a match, so `assert_text("Save", "present")` passed on a screen whose only "save" was
inside "Unsaved changes" — a green verdict for a button that was not there — and
`mode: "absent"` failed on that same screen. Presence is now decided by exact, fuzzy, and
whole-word substring matches; mid-word hits are reported under a new `incidental` field so
nothing is hidden from the caller.

**`find_element` could return the destructive button.** Every substring match scored a flat
`0.9`, so the sort fell through to OCR emission order: on a Save / Don't Save dialog with no
exact "Save", the query `Save` returned `Don't Save` first, with a clickPoint. Substring scores
are now graded by word boundaries, prefix position, and coverage, and each match reports
`wholeWord`.

**`vision_capabilities` claimed abilities it had not checked.** `capture.windowCapture` and
`regionCapture` were hardcoded `true` and were returned unchanged — even alongside
`screenRecording: false`, and even on the error path — by the one tool whose stated job is to
explain why capture failed. They are now derived from the permissions actually reported, joined
by `ready` and `blockers`; the error path no longer makes capability claims at all. The
description also promised a `uiHelper` field that nothing ever produced: the real
`helperVersion` replaces it, and a contract test now fails if a description promises a field the
handler does not return.

**`list_windows` presented withheld titles as absent ones.** Without Screen Recording, macOS
returns no window names, so every `title` was `""` — indistinguishable from a genuinely untitled
window. The response is now `{ titlesAvailable, note?, windows }`, which flags that case
explicitly. **This changes the shape of the `list_windows` result** from a bare array to an
object with the array under `windows`.

Also: window-targeted captures report an `obstruction` field when other windows cover the
target. Window capture sees through them; a click at the returned coordinates would not — it
would land on the app in front.

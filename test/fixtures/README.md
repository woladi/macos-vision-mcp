# Test fixtures

Two rendered dialogs, each built to pin one bug that shipped in 0.6.7 and was found by
running the tools against a real screen:

- `dialog-ambiguous.png` — "Don't Save" and "Save Changes" side by side, with no exact
  "Save" anywhere. Before the substring score was graded, `find_element("Save")` scored
  both 0.9 and returned whichever OCR emitted first — the destructive button.
- `dialog-autosaved.png` — the words "Unsaved changes" and "autosaved", and no Save
  button at all. `assert_text("Save", "present")` passed on it, and
  `assert_text("Save", "absent")` failed on it.

Regenerate after editing a `.json` spec (macOS only, needs Swift):

    swift test/fixtures/render-fixture.swift test/fixtures/dialog-ambiguous.json test/fixtures/dialog-ambiguous.png

Rendering with CoreText rather than screenshotting keeps the fixtures identical on every
machine, so an OCR assertion in the suite fails because of a code change and nothing else.

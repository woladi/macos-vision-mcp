---
"macos-vision-mcp": minor
---

feat: local UI-testing tools — `vision_capabilities`, `list_windows`, `capture_screen`, `read_screen_text`, `find_element`, `assert_text`

An agent can now see and verify macOS UI without sending a screenshot to a cloud model: capture happens locally, OCR runs on-device, and only paths, geometry and extracted text leave the module. `find_element` returns a whole-pixel `clickPoint` in global screen points, ready for any input driver — this server deliberately does not click. A locked screen is detected and reported outright instead of surfacing as an opaque capture failure.

Also raises the `macos-vision` dependency to ^1.6.0, which carries the `ui-helper` binary as a prebuilt; the interim `swiftc`-on-first-use compile stays for now (see docs/PLAN-ui-testing-vision.md).

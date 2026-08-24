---
"macos-vision-mcp": patch
---

docs: keywords and descriptions that mention the half of this tool they were omitting

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

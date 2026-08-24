---
"macos-vision-mcp": patch
---

docs: add a "What agents use this for" chapter

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

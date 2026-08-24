---
"macos-vision-mcp": patch
---

docs: correct the 0.6.3 changelog claim about npm and relative images

0.6.3 claimed the old relative image path meant npm showed no image at all. That
was wrong. The check behind it was grepping the npm package page's HTML, which is
client-rendered and carries no README markup — so it could not have found an
image whether or not one rendered.

Verified properly in a browser afterwards: npm rewrites a relative path to
`raw.githubusercontent.com/<repo>/HEAD/…` and the previous hero did load on the
package page. The switch to absolute URLs is still worthwhile — it pins each
image to `master` rather than floating on `HEAD` — but it repaired nothing that
was broken, and the changelog now says so.

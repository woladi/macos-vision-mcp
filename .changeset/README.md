# Changesets

Every user-visible change goes in with a changeset: run `npm run changeset`,
pick patch / minor / major, and describe the change for the CHANGELOG. The file
it writes here is committed with the PR.

On merge to `master` the Release workflow collects pending changesets into a
"version packages" PR (bumping `package.json`, `package-lock.json`,
`server.json` and `CHANGELOG.md`). Merging _that_ PR is what publishes to npm,
tags the release, and refreshes the MCP registry entry.

See https://github.com/changesets/changesets for the full docs.

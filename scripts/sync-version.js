#!/usr/bin/env node
/**
 * Propagates the version in package.json to the two places that carry a copy
 * of it: the MCP registry manifest (server.json — both the server version and
 * the npm package version it points at) and the root entry of the lockfile.
 *
 * Runs as part of `npm run version-packages`, so the "version packages" PR
 * that changesets opens already contains the synced files and the registry
 * publish step has nothing left to fix up at release time.
 */
import { readFileSync, writeFileSync } from "node:fs";
import prettier from "prettier";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const { version } = read("package.json");

// server.json is hand-maintained and prettier-formatted. Feed prettier the
// indented form (its JSON printer preserves object expansion but collapses
// short arrays), so a version bump touches the version lines and nothing else.
const server = read("server.json");
server.version = version;
for (const pkg of server.packages ?? []) pkg.version = version;
const options = await prettier.resolveConfig("server.json");
writeFileSync(
  "server.json",
  await prettier.format(JSON.stringify(server, null, 2), { ...options, filepath: "server.json" }),
);

// npm writes lockfiles as JSON.stringify(…, 2) + newline; match it exactly.
const lock = read("package-lock.json");
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

console.log(`synced server.json and package-lock.json to ${version}`);

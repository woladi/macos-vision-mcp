import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the repo's own suite: a git worktree checked out under .claude/
    // (or a build output) would otherwise be collected twice.
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".claude/**"],
  },
});

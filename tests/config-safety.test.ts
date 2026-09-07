import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("configuration guard rejects force-staged local profiles and ignores generated files", () => {
  const dir = mkdtempSync(join(tmpdir(), "ap-config-"));
  const guard = resolve("scripts/check-config.mjs");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "--quiet");
    copyFileSync(".gitignore", join(dir, ".gitignore"));
    for (const name of [
      "mcp.local.json",
      "mcp.template.json",
      "private.local.json",
      ".env",
      "analytics.sqlite",
    ]) {
      writeFileSync(join(dir, name), "fixture-only");
      assert.equal(git("check-ignore", name).trim(), name);
    }
    assert.equal(spawnSync(process.execPath, [guard], { cwd: dir }).status, 0);
    git("add", "--force", "mcp.local.json");
    const blocked = spawnSync(process.execPath, [guard], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /mcp.local.json/);
    assert.ok(!blocked.stderr.includes("fixture-only"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

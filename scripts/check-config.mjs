import { execFileSync } from "node:child_process";
const tracked = execFileSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const forbidden = tracked.filter(
  (p) =>
    /(^|\/)\.data\//.test(p) ||
    (/(^|\/)\.env($|\.)/.test(p) && !p.endsWith(".example")) ||
    /(^|\/)mcp[^/]*\.json$/i.test(p) ||
    p.endsWith(".local.json") ||
    /\.sqlite/i.test(p),
);
if (forbidden.length) {
  console.error(
    "Local configuration/data must not be tracked:\n" + forbidden.join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "No populated local configuration or databases are tracked/staged.",
  );

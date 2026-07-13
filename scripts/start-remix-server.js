import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const serverRoot = join(process.cwd(), "build", "server");
const directEntry = join(serverRoot, "index.js");

function findServerEntry() {
  if (existsSync(directEntry)) return directEntry;

  const entries = readdirSync(serverRoot, { withFileTypes: true });
  const serverEntry = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(serverRoot, entry.name, "index.js"))
    .find((entryPath) => existsSync(entryPath));

  if (!serverEntry) {
    throw new Error("Unable to find Remix server build entry.");
  }

  return serverEntry;
}

const remixServeCli = join(
  process.cwd(),
  "node_modules",
  "@remix-run",
  "serve",
  "dist",
  "cli.js",
);

const child = spawn(process.execPath, [remixServeCli, findServerEntry()], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

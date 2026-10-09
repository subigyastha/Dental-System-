import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const limits = new Map([["AGENTS.md", 400], ["docs/progress.md", 500]]);
let failed = false;
for (const [file, limit] of limits) {
  try {
    const text = await readFile(path.join(root, file), "utf8");
    const words = text.trim().split(/\s+/u).filter(Boolean).length;
    console.log(`${file}: ${words}/${limit} words, ${Buffer.byteLength(text)} bytes`);
    if (words > limit) failed = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log(`${file}: missing`);
    failed = true;
  }
}
const entries = await readdir(path.join(root, "docs"), { withFileTypes: true });
const sizes = await Promise.all(entries.filter(e => e.isFile() && /\.(md|html)$/u.test(e.name)).map(async e => ({
  name: e.name, bytes: (await stat(path.join(root, "docs", e.name))).size
})));
console.log("Largest on-demand references (bytes, not token estimates):");
for (const file of sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 5)) console.log(`${file.bytes} ${file.name}`);
if (process.argv.includes("--check") && failed) process.exitCode = 1;

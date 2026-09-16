import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let prismaCli;
try {
  prismaCli = require.resolve("prisma/build/index.js");
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") {
    throw error;
  }

  console.log(
    "Prisma CLI is not installed; skipping client generation for this frontend-only install.",
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [prismaCli, "generate"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

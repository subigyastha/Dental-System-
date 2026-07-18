import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const CONTROLLERS_ROOT = resolve(ROOT, "apps/api/src/modules");
const inventoryFile = resolve(ROOT, "apps/api/src/route-inventory.ts");
const inventory = readFileSync(inventoryFile, "utf8");
const inventoryControllers = new Set(
  [...inventory.matchAll(/controller:\s*"([^"]+)"/g)].map((match) => match[1]),
);
const controllerFiles = findControllerFiles(CONTROLLERS_ROOT);
const discoveredControllers = new Map();
const violations = [];
let handlerCount = 0;

for (const file of controllerFiles) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/@Controller\("([^"]+)"\)/);
  if (!match) {
    violations.push(`${relative(ROOT, file)}: controller path is not a string literal`);
    continue;
  }

  const controller = match[1];
  if (discoveredControllers.has(controller)) {
    violations.push(`${relative(ROOT, file)}: duplicate controller path '${controller}'`);
  }
  discoveredControllers.set(controller, file);
  if (!inventoryControllers.has(controller)) {
    violations.push(`${relative(ROOT, file)}: '${controller}' has no route classification`);
  }

  const handlers = [...source.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(/g)];
  if (!handlers.length) {
    violations.push(`${relative(ROOT, file)}: '${controller}' has no HTTP handler classification`);
  }
  handlerCount += handlers.length;
}

for (const controller of inventoryControllers) {
  if (!discoveredControllers.has(controller)) {
    violations.push(`route inventory: '${controller}' does not have a matching controller`);
  }
}

const publicRoutes = controllerFiles.filter((file) => readFileSync(file, "utf8").includes("@PublicRoute()"));
const expectedPublicControllers = new Set(["auth.controller.ts", "health.controller.ts"]);
for (const file of publicRoutes) {
  if (!expectedPublicControllers.has(file.split(/[\\/]/).at(-1))) {
    violations.push(`${relative(ROOT, file)}: unexpected public route decorator`);
  }
}

const expectedPublicActionCount = [...inventory.matchAll(/publicActions:\s*\[([^\]]*)\]/g)]
  .reduce((count, match) => count + (match[1].match(/"(?:GET|POST|PUT|PATCH|DELETE)\s+[^"\]]+"/g)?.length ?? 0), 0);
const expectedPublicActions = new Set(
  [...inventory.matchAll(/"((?:GET|POST|PUT|PATCH|DELETE)\s+[^"\]]+)"/g)].map((match) => match[1]),
);
const actualPublicActions = new Set();
for (const file of controllerFiles) {
  const source = readFileSync(file, "utf8");
  const controller = source.match(/@Controller\("([^"]+)"\)/)?.[1];
  for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)\("?([^"\)]*)"?\)\s*@PublicRoute\(\)/g)) {
    actualPublicActions.add(`${match[1].toUpperCase()} /${match[2]}`);
  }
  if (source.includes("@PublicRoute()") && !controller) {
    violations.push(`${relative(ROOT, file)}: public action has no controller path`);
  }
}
if (expectedPublicActionCount !== actualPublicActions.size) {
  violations.push(
    `route inventory: expected ${expectedPublicActionCount} explicit public actions but found ${actualPublicActions.size} bound handlers`,
  );
}
for (const action of expectedPublicActions) {
  if (!actualPublicActions.has(action)) {
    violations.push(`route inventory: '${action}' is not bound to a @PublicRoute() handler`);
  }
}
for (const action of actualPublicActions) {
  if (!expectedPublicActions.has(action)) {
    violations.push(`route inventory: '${action}' is public but not in the inventory`);
  }
}

if (violations.length) {
  console.error("Nest route inventory check failed:");
  violations.forEach((violation) => console.error(`  ${violation}`));
  process.exitCode = 1;
} else {
  console.log(
    `Nest route inventory check passed (${handlerCount} handlers across ${discoveredControllers.size} controller classes; public exceptions limited to login and health).`,
  );
}

function findControllerFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findControllerFiles(path);
    }
    return entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

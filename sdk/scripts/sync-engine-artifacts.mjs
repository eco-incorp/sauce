#!/usr/bin/env node
// The performance package is one compiler/runtime wire revision. Verify every
// committed input before copying it; a missing or stale asset is a build error.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "engine-performance.json"), "utf8"));
if (manifest.format !== 1 || manifest.isa !== "stack-compact-v1") {
  throw new Error("Unsupported engine artifact manifest");
}
for (const [file, expected] of Object.entries(manifest.artifacts)) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(root, file)))
    .digest("hex");
  if (actual !== expected) throw new Error(`${file}: SHA-256 ${actual} != pinned ${expected}`);
}
const source = resolve(root, "vendor/performance");
for (const directory of ["sdk/src/artifacts", "sdk/dist/artifacts"]) {
  const destination = resolve(root, directory);
  mkdirSync(destination, { recursive: true });
  for (const name of [
    "IERC20",
    "IUniswapV3Pool",
    "Router",
    "ISauceRouter",
    "V12Pot",
    "V12Kitchen",
    "V12RuntimeBytecode",
  ]) {
    copyFileSync(resolve(source, `${name}.json`), resolve(destination, `${name}.json`));
  }
}
mkdirSync(resolve(root, "artifacts/svm"), { recursive: true });
for (const name of ["engine.so", "kitchen.so"]) {
  copyFileSync(resolve(source, name), resolve(root, "artifacts/svm", name));
}
console.log(
  `[sync-engine-artifacts] verified ${Object.keys(manifest.artifacts).length} pinned inputs (${manifest.isa})`,
);
if (process.argv.includes("--fetch-v12-engines")) {
  for (const [name, file] of Object.entries({
    SAUCE_RUST_ENGINE_SO: "engine.so",
    SAUCE_KITCHEN_SO: "kitchen.so",
    SAUCE_ENGINE_WIRE_JSON: "engine-wire.json",
    SAUCE_KITCHEN_IDL_JSON: "kitchen-idl.json",
    SAUCE_V12_RUNTIME_CREATION_HEX: "runtime.creation.hex",
  }))
    console.log(`${name}=${resolve(source, file)}`);
}

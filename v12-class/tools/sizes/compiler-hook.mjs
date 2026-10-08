// Resolves `sauce-compiler` to the package in SAUCE_COMPILER_PKG (a built crates/sauce-wasm/pkg),
// so one SDK build can be measured against any compiler build without relinking it.
import { mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const pkg = process.env.SAUCE_COMPILER_PKG;
let parent;
if (pkg !== undefined) {
  const dir = join(tmpdir(), `sauce-compiler-hook-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(resolvePath(pkg), join(dir, "node_modules", "sauce-compiler"));
  parent = pathToFileURL(join(dir, "anchor.js")).href;
}

export async function resolve(specifier, context, next) {
  if (parent !== undefined && (specifier === "sauce-compiler" || specifier.startsWith("sauce-compiler/"))) {
    return next(specifier, { ...context, parentURL: parent });
  }
  return next(specifier, context);
}

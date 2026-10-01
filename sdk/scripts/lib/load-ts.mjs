// Evaluates SDK source modules straight from `src/`, for the generators: no build, and the values
// read are the ones the SDK itself ships, not a parse of their text.
//
// Each `.ts` file is transpiled to CommonJS with the `typescript` package and evaluated with a
// `require` that resolves the SDK's own `./x.js` specifiers to `./x.ts`, reads `.json` files, and
// hands bare package specifiers to Node. Type-only imports vanish in the transpile, so a registry
// module costs only the runtime modules it really imports.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

/** A loader rooted at `sdkDir`; modules are cached per loader, as a module system would. */
export function createTsLoader(sdkDir) {
  const cache = new Map();
  const requirePackage = createRequire(resolve(sdkDir, "package.json"));

  function resolveFile(fromDir, specifier) {
    const base = resolve(fromDir, specifier);
    const candidates = base.endsWith(".js")
      ? [base.slice(0, -3) + ".ts", base]
      : [base, `${base}.ts`, resolve(base, "index.ts")];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined)
      throw new Error(`load-ts: cannot resolve '${specifier}' from ${fromDir}`);
    return found;
  }

  function load(path) {
    const cached = cache.get(path);
    if (cached !== undefined) return cached.exports;
    const module = { exports: {} };
    cache.set(path, module);
    if (path.endsWith(".json")) {
      module.exports = JSON.parse(readFileSync(path, "utf8"));
      return module.exports;
    }
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    });
    const localRequire = (specifier) =>
      specifier.startsWith(".")
        ? load(resolveFile(dirname(path), specifier))
        : requirePackage(specifier);
    new Function("exports", "require", "module", outputText)(module.exports, localRequire, module);
    return module.exports;
  }

  return (relativePath) => load(resolve(sdkDir, relativePath));
}

/**
 * @eco-incorp/sauce/svm/engine — the CommonJS-safe engine subpath.
 *
 * It exists so a CJS consumer (e.g. eco-solver) can pull the engine wire contract + instruction builders
 * WITHOUT reaching through the `./svm` barrel, which re-exports `svm/recipes` and its ESM `__dirname`
 * shim (`fileURLToPath(import.meta.url)`) — that shim collides with the CJS module-wrapper `__dirname`
 * under a ts-jest/babel-jest transform. The invariant that keeps this subpath CJS-safe: nothing in its
 * transitive module graph touches the filesystem or `import.meta`. This test guards that boundary so a
 * future re-export cannot silently pull recipes (or any fs-touching module) back in.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as engine from "../../src/svm/engine-public.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../dist/svm");

describe("svm/engine subpath surface", () => {
  it("exposes the released engine's two execute builders", () => {
    const builders = ["buildExecuteInstruction", "buildExecuteFromAccountInstruction"];
    for (const name of builders)
      expect(typeof (engine as Record<string, unknown>)[name]).toBe("function");
  });

  it("exposes the released engine's discriminators and the heap-frame constant", () => {
    const consts = [
      "EXECUTE_DISCRIMINATOR",
      "EXECUTE_FROM_ACCOUNT_DISCRIMINATOR",
      "CLOSE_ACCOUNT_DISCRIMINATOR",
      "HEAP_FRAME_BYTES",
    ];
    for (const name of consts) expect((engine as Record<string, unknown>)[name]).toBeDefined();
  });
});

describe("svm/engine subpath — fs-free module graph (CJS-safety regression guard)", () => {
  /** Transitively collect every LOCAL (relative) module reachable from a built entry, following both
   *  `... from './x.js'` re-exports/imports and bare `import './x.js'` side-effect imports. External
   *  packages (@solana/*) are out of scope — only the SDK's own graph must stay fs-free. */
  function graph(entry: string, seen = new Set<string>()): string[] {
    if (seen.has(entry)) return [];
    seen.add(entry);
    let src: string;
    try {
      src = readFileSync(entry, "utf8");
    } catch {
      return [];
    }
    const out = [entry];
    const specs = new Set<string>();
    for (const m of src.matchAll(/(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]/g))
      specs.add(m[1]!);
    for (const m of src.matchAll(/import\s*['"](\.[^'"]+)['"]/g)) specs.add(m[1]!);
    for (const spec of specs) out.push(...graph(resolve(dirname(entry), spec), seen));
    return out;
  }

  /** Strip block + line comments — a doc comment may legitimately NAME the forbidden constructs to
   *  explain the boundary (engine-public.js's own header does); only real CODE usage should fail. */
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("reaches only fs-free modules — none declares __dirname/__filename or references import.meta / node:fs / node:path", () => {
    const files = graph(resolve(DIST, "engine-public.js"));
    expect(files.length).toBeGreaterThan(2); // sanity: actually walked engine + instructions + abi
    const offenders = files.filter((f) => {
      const s = stripComments(readFileSync(f, "utf8"));
      return (
        /import\.meta|fileURLToPath/.test(s) ||
        /['"]node:(?:fs|path)['"]/.test(s) ||
        /\b(?:const|let|var)\s+(?:__dirname|__filename)\b/.test(s)
      );
    });
    expect(offenders.map((f) => f.replace(DIST, "."))).toEqual([]);
  });

  it("never reaches svm/recipes (the __dirname offender the barrel pulls in)", () => {
    const files = graph(resolve(DIST, "engine-public.js"));
    expect(files.some((f) => f.includes("/recipes/"))).toBe(false);
  });
});

/**
 * DRIFT GUARD for the eco-routes ambient globals.
 *
 * Two independent assertions, deliberately not one:
 *  1. Generator-vs-committed: what `gen-route-globals.mjs --stdout` produces
 *     RIGHT NOW, string-equal to the committed `globals.generated.ts`. Spawned
 *     as a child process (not imported) both because jest's transform here
 *     only matches `.ts`/`.js` (a `.mjs` isn't importable under this config)
 *     and because spawning is the more faithful "what would the generator
 *     actually produce" check.
 *  2. Registry-vs-committed, generator-INDEPENDENT: every canonical chain's
 *     PascalCase name appears exactly once as a `const <Name>:` declaration
 *     in the committed file. This is what stops a BROKEN generator from
 *     making assertion 1 vacuously pass (the same gap
 *     `test/svm/engine-abi-drift.test.ts` calls out: "a NEW artifact key the
 *     generator silently dropped").
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalChains } from "../src/chains/canonical.js";
import { pascalOfSlug } from "../src/routes/index.js";

const SDK_DIR = resolve(process.cwd());
const SCRIPT_PATH = resolve(SDK_DIR, "scripts", "gen-route-globals.mjs");
const GENERATED_PATH = resolve(SDK_DIR, "src", "routes", "globals.generated.ts");

describe("routes globals ambient .d.ts drift guard", () => {
  const committed = readFileSync(GENERATED_PATH, "utf8");

  it("the committed file matches what the generator produces from the current registry right now", () => {
    const fresh = execFileSync(process.execPath, [SCRIPT_PATH, "--stdout"], {
      cwd: SDK_DIR,
      encoding: "utf8",
    });
    expect(committed).toBe(fresh);
  });

  it("every canonical chain's PascalCase name has exactly one ambient declaration (generator-independent)", () => {
    for (const c of canonicalChains) {
      const name = pascalOfSlug(c.slug);
      const matches = committed.match(new RegExp(`\\bconst ${name}: ChainGlobals\\[`, "g")) ?? [];
      expect(matches).toHaveLength(1);
    }
  });

  it("the declared-name count is exactly canonicalChains.length + 2 (`chain` and the universal `Token` global)", () => {
    const constDecls = committed.match(/^\s*const \w+: /gm) ?? [];
    expect(constDecls).toHaveLength(canonicalChains.length + 2);
  });

  it("the fixed `Token` global is declared exactly once, as the real TokenApi INTERSECTED with its call signature", () => {
    // Both halves are load-bearing and pinned together: `TokenApi` is the object API (and the
    // reason this is not `any`), `TokenFactory` is the call signature that makes `Token(addr)`
    // typecheck in a typed closure body. Dropping either silently removes a capability —
    // `routes-globals-ambient-types.test.ts` is what proves each one actually works.
    const matches = committed.match(/\bconst Token: TokenApi & TokenFactory;/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("`--check` exits 0 against the committed file (no drift)", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT_PATH, "--check"], { cwd: SDK_DIR, encoding: "utf8" }),
    ).not.toThrow();
  });

  it("every chain declaration also carries the E2.3 `& ChainContracts` intersection (a generator that dropped it can't pass vacuously)", () => {
    for (const c of canonicalChains) {
      const name = pascalOfSlug(c.slug);
      // svm-kind chains ALSO carry E2.5's `& SvmVenueAccessors` -- see the dedicated
      // assertion below, which pins that suffix to exactly the svm chains and no others.
      const svm = c.kind === "svm" ? " & SvmVenueAccessors" : "";
      const matches = committed.match(new RegExp(`\\bconst ${name}: ChainGlobals\\["${name}"\\] & ChainContracts${svm};`, "g")) ?? [];
      expect(matches).toHaveLength(1);
    }
  });

  it("E2.5: the `& SvmVenueAccessors` intersection appears exactly once, and only on svm-kind chains", () => {
    const svmChains = canonicalChains.filter((c) => c.kind === "svm");
    const matches = committed.match(/&\s*SvmVenueAccessors;/g) ?? [];
    expect(matches).toHaveLength(svmChains.length);
    for (const c of svmChains) {
      const name = pascalOfSlug(c.slug);
      expect(committed).toContain(`const ${name}: ChainGlobals["${name}"] & ChainContracts & SvmVenueAccessors;`);
    }
  });

  it("the generator source itself carries the Token name-collision guard (statically present, not just asserted by this suite)", () => {
    const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
    expect(scriptSrc).toContain("TOKEN_GLOBAL_NAME");
    expect(scriptSrc).toMatch(/collides with the fixed .* global/);
  });
});

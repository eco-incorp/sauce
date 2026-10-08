/**
 * P7 — chain-bundle activation: the ambient-MODULE dimension (`chainAmbient`, `ambient.ts`)
 * a program compile adds (`compileSauceProgram`), alongside the scalar-defines half (`chainDefines`,
 * see `routes-ambient.test.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireChain } from "../src/chains/canonical.js";
import { chainAmbient } from "../src/routes/index.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const AMBIENT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rs-ambient");
/** Serves the fixture directory off disk, as a caller's own `resolve` would. */
const resolveFixture = (path: string): Uint8Array | undefined => {
  const full = join(AMBIENT_FIXTURE_DIR, path);

  return existsSync(full) ? readFileSync(full) : undefined;
};
/** The SPL Token program — any valid base58 program id serves as an SVM execution buffer here. */
const SVM_BUFFER = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as const;

describe("chainAmbient", () => {
  // `@sauce/token` ships as the default ambient MODULE: it is activated for every program compile,
  // resolvable because the SDK serves its own copy (`embedded/resolve.ts`) whatever the caller
  // resolves. The default-path test at the bottom of this file proves an UNUSED
  // ambient module leaves bytecode untouched.
  it("is ['@sauce/token'] for every chain — the token stdlib is the default ambient module", () => {
    expect(chainAmbient(requireChain("base"))).toEqual(["@sauce/token"]);
    expect(chainAmbient(requireChain("solana"))).toEqual(["@sauce/token"]);
  });
});

describe("a program compile: chain-scoped ambient bundle activation (P7)", () => {
  const bareBody = "function main() { return double(21n); }"; // no `import` line anywhere

  it("a program using an ambient symbol compiles via the RS path when the merged ambient list is non-empty", () => {
    const built = compileSauceProgram("base", bareBody, {
      resolve: resolveFixture,
      ambient: ["./math-helpers.js"],
    });
    expect(built.bytecode.length).toBeGreaterThan(0);
  });

  it("is byte-identical to calling compileSauceRoute directly with the same ambient list", () => {
    const program = compileSauceProgram("base", bareBody, {
      resolve: resolveFixture,
      ambient: ["./math-helpers.js"],
    });

    const direct = compileSauceRoute(
      requireChain("base"),
      bareBody,
      { pot: POT, engine: ENGINE },
      {
        resolve: resolveFixture,
        // A program compile merges chainAmbient() (`@sauce/token`) with the caller's list -- match
        // that merge here so this is a true apples-to-apples bytecode comparison.
        ambient: ["@sauce/token", "./math-helpers.js"],
        // The chain's own values, given as defines, are the chain's module's.
        defines: {
          chainId: BigInt(requireChain("base").id),
          CHAIN_ID: BigInt(requireChain("base").id),
        },
      },
    );

    expect(Array.from(program.bytecode)).toEqual(Array.from(direct.compiled.bytecode[0]!));
  });

  it("default bundle (@sauce/token, UNUSED): bytecode is byte-identical to no ambient module at all", () => {
    const built = compileSauceProgram("base", "function main() { return chainId; }");
    expect(built.bytecode.length).toBeGreaterThan(0);

    // The default `@sauce/token` ambient module is broadcast into this compile but the program uses
    // none of its exports, so it treeshakes away -- the bytecode is byte-identical to compiling with
    // NO ambient module, only the chain's names. This is what proves the
    // default flip costs a token-free route nothing (routes-ambient.test.ts pins the chainDefines
    // half of the same equivalence).
    const withoutAmbient = compileSauceRoute(
      requireChain("base"),
      "function main() { return chainId; }",
      { pot: POT, engine: ENGINE },
      {
        defines: {
          chainId: BigInt(requireChain("base").id),
          CHAIN_ID: BigInt(requireChain("base").id),
        },
      },
    );
    expect(Array.from(built.bytecode)).toEqual(Array.from(withoutAmbient.compiled.bytecode[0]!));
  });

  it("default bundle on an SVM destination too: an unused @sauce/token treeshakes to the same bytes", () => {
    // The EVM twin above proved the default flip is free for a token-free EVM route. `chainAmbient`
    // returns the same list for every chain, so the SVM arm (`token.svm.js`) is broadcast into an
    // SVM compile just as unconditionally — and a treeshake regression there would be invisible to
    // the EVM assertion.
    const body = "function main() { return chainId; }";
    const built = compileSauceProgram("solana", body);
    expect(built.bytecode.length).toBeGreaterThan(0);

    const withoutAmbient = compileSauceRoute(
      requireChain("solana"),
      body,
      { code: SVM_BUFFER, accounts: [] },
      {
        defines: {
          chainId: BigInt(requireChain("solana").id),
          CHAIN_ID: BigInt(requireChain("solana").id),
        },
      },
    );
    expect(Array.from(built.bytecode)).toEqual(Array.from(withoutAmbient.compiled.bytecode[0]!));
  });
});

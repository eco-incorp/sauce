/**
 * P7 — chain-bundle activation: the ambient-MODULE dimension (`chainAmbient`, `ambient.ts`)
 * threaded into `openRoute`'s compile seam (`intent-dsl.ts`), alongside the already-landed
 * scalar-defines half (`chainDefines`, see `routes-ambient.test.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireChain } from "../src/chains/canonical.js";
import { chainAmbient, openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const AMBIENT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rs-ambient");
/** Serves the fixture directory off disk, as a caller's own `resolve` would. */
const resolveFixture = (path: string): Uint8Array | undefined => {
  const full = join(AMBIENT_FIXTURE_DIR, path);

  return existsSync(full) ? readFileSync(full) : undefined;
};
/** The SPL Token program — any valid base58 program id serves as an SVM execution buffer here. */
const SVM_BUFFER = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

describe("chainAmbient", () => {
  // `@sauce/token` ships as the default ambient MODULE: it is activated for every openRoute compile,
  // resolvable because the SDK serves its own copy (`embedded/resolve.ts`) whatever the caller
  // resolves. The default-path test at the bottom of this file proves an UNUSED
  // ambient module leaves bytecode untouched.
  it("is ['@sauce/token'] for every chain — the token stdlib is the default ambient module", () => {
    expect(chainAmbient(requireChain("base"))).toEqual(["@sauce/token"]);
    expect(chainAmbient(requireChain("solana"))).toEqual(["@sauce/token"]);
  });
});

describe("openRoute: chain-scoped ambient bundle activation (P7)", () => {
  const bareBody = "function main() { return double(21n); }"; // no `import` line anywhere

  it("a program using an ambient symbol compiles via the RS path when the merged ambient list is non-empty", () => {
    const built = openRoute(
      "base",
      bareBody,
      evmOptions({
        compile: { resolve: resolveFixture, ambient: ["./math-helpers.js"] },
      }),
    ).reward(0n);
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("is byte-identical to calling compileSauceRoute directly with the same ambient list", () => {
    const viaOpenRoute = openRoute(
      "base",
      bareBody,
      evmOptions({
        compile: { resolve: resolveFixture, ambient: ["./math-helpers.js"] },
      }),
    ).reward(0n);

    const direct = compileSauceRoute(
      requireChain("base"),
      bareBody,
      { pot: POT, engine: ENGINE },
      {
        resolve: resolveFixture,
        // openRoute merges chainAmbient() (`@sauce/token`) with the caller's list -- match that merge
        // here so this is a true apples-to-apples bytecode comparison, not a false negative.
        ambient: ["@sauce/token", "./math-helpers.js"],
        // openRoute also threads chain-scoped scalar defines (chainId/CHAIN_ID) underneath -- match
        // them here so this is a true apples-to-apples bytecode comparison, not a false negative.
        defines: {
          chainId: BigInt(requireChain("base").id),
          CHAIN_ID: BigInt(requireChain("base").id),
        },
      },
    );

    expect(Array.from(viaOpenRoute.compiled.bytecode[0]!)).toEqual(
      Array.from(direct.compiled.bytecode[0]!),
    );
  });

  it("default bundle (@sauce/token, UNUSED): bytecode is byte-identical to no ambient module at all", () => {
    const built = openRoute("base", "function main() { return chainId; }", evmOptions()).reward(0n);
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);

    // The default `@sauce/token` ambient module is broadcast into this compile but the program uses
    // none of its exports, so it treeshakes away -- the bytecode is byte-identical to compiling with
    // NO ambient module, only the chain defines openRoute threads underneath. This is what proves the
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
    expect(Array.from(built.compiled.bytecode[0]!)).toEqual(
      Array.from(withoutAmbient.compiled.bytecode[0]!),
    );
  });

  it("default bundle on an SVM destination too: an unused @sauce/token treeshakes to the same bytes", () => {
    // The EVM twin above proved the default flip is free for a token-free EVM route. `chainAmbient`
    // returns the same list for every chain, so the SVM arm (`token.svm.js`) is broadcast into an
    // SVM compile just as unconditionally — and a treeshake regression there would be invisible to
    // the EVM assertion.
    const body = "function main() { return chainId; }";
    const built = openRoute("solana", body, {
      execution: { code: SVM_BUFFER, accounts: [] },
      deadline: 2000n,
      portal: PORTAL,
      source: "base",
      creator: "0x3333333333333333333333333333333333333333",
      prover: "0x4444444444444444444444444444444444444444",
      rewardDeadline: 1000n,
    }).reward(0n);
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);

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
    expect(Array.from(built.compiled.bytecode[0]!)).toEqual(
      Array.from(withoutAmbient.compiled.bytecode[0]!),
    );
  });
});

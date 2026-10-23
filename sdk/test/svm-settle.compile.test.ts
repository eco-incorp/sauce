/**
 * THE PARTNER REPRODUCIBILITY + GENERICITY GUARD for the SVM `settle` recipe — the SVM analogue of
 * `verify.compile.test.ts`.
 *
 * We hand partners a snippet (see `sdk/src/svm/recipes/index.ts`'s module doc) that compiles the SVM
 * `settle.sauce.ts` with the ORDINARY compiler for `target: 'svm'`, passing the settlement's
 * `SETTLE_MIN_OUT`/`SETTLE_SPL_COUNT` as `defines`, and tells them the result is byte-identical to
 * the program we hand them. This test IS that snippet, run for real, plus the structural checks a
 * partner would want before trusting the compiled account manifest.
 *
 * Options stay LITERAL below, never behind a helper — a partner reproducing our bytes needs to see
 * the target/defines surface directly, which is why this file loads the compiler itself instead of
 * going through `test/helpers.ts`'s `compileSource` (that wrapper supplies `entry` and `resolve` and
 * marshals the defines, i.e. exactly the surface a partner has to match). NEGATIVE CONTROL ON REPO
 * POLICY: this file must never gain an expected-hash / expected-bytecode constant — partner verify is
 * "recompile and byte-compare against what you received", never "compare against a hash we shipped".
 */
import { readFileSync } from "fs";
import { createRequire } from "node:module";
import { resolve } from "path";
import type { CompileOptions, CompileResult } from "sauce-compiler";
import { SVM_MAX_ESCROWS, svmSettleRefs, svmSettleSource } from "../src/svm/index.js";

// Required via `createRequire`, not `import`: the package's `node` condition is a CommonJS build that
// reads its sibling `.wasm` off disk at load, and jest's ESM transform does not resolve that sibling.
const { compile } = createRequire(import.meta.url)("sauce-compiler") as {
  compile: (options: CompileOptions) => CompileResult;
};

/** `main`'s declared slots as `[name, writable, signer]` — the manifest's whole content. */
const slots = (
  manifest: { accounts: readonly unknown[] } | undefined,
): [string, boolean, boolean][] =>
  (manifest?.accounts ?? []).flatMap((entry) => {
    const slot = entry as { kind: string; name: string; requires: string };
    if (slot.kind !== "slot") return [];

    return [
      [slot.name, slot.requires.startsWith("writable"), slot.requires.endsWith("signer")] as [
        string,
        boolean,
        boolean,
      ],
    ];
  });

/** THE SNIPPET — kept verbatim-equivalent to the one in `svm/recipes/index.ts`'s docstring. */
function partnerCompile(escrowCount = 1, minOut = 0n, splCount = 0n): CompileResult {
  const source = svmSettleSource(escrowCount);

  return compile({
    target: "svm",
    entry: "main.js",
    resolve: (path) => (path === "main.js" ? Buffer.from(source) : undefined),
    defines: [
      ["SETTLE_MIN_OUT", String(minOut)],
      ["SETTLE_SPL_COUNT", String(splCount)],
    ],
  });
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("svm settle — partner reproducibility", () => {
  it("the documented snippet compiles: real bytecode and an account manifest", () => {
    const { bytecode, manifest } = partnerCompile();
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest).toBeDefined();
  });

  it("N=1: the manifest is the documented refs, in order, with the right roles", () => {
    expect(slots(partnerCompile(1).manifest)).toEqual([
      ["tokenProgram0", false, false],
      ["tokenProgram1", false, false],
      ["escrow0", true, false], // source, drained
      ["mint0", false, false], //  read for decimals by TransferChecked
      ["dest0", true, false], //   recipient's ATA, receives
      ["owner", false, true], //   authority that signs the transfer
    ]);
  });

  it("★ svmSettleRefs(n) matches the compiled manifest order for every n", () => {
    // `owner` sits right after escrow0's trio, not last — that is `main`'s declaration order. A caller
    // builds its AccountResolution from svmSettleRefs, so a wrong order would land accounts in the
    // wrong slots — pinned against a real compile rather than asserted by eye.
    for (const n of [1, 2, 3, 5, SVM_MAX_ESCROWS]) {
      expect(slots(partnerCompile(n).manifest).map(([name]) => name)).toEqual(svmSettleRefs(n));
    }
  });

  it("per escrow attaches (escrow, mint, dest); mint is there because TransferChecked (ix 12) reads its decimals", () => {
    const src = svmSettleSource(2);
    expect(src).toContain("hex`0c`"); // TransferChecked discriminator, not legacy 3
    expect(src).toContain("svm.sload(mint0, 44, 1).toLe()"); // decimals read on-chain from the mint
    expect(src).toContain("svm.sload(mint1, 44, 1).toLe()");
    // both token programs are declared slots so SETTLE_SPL_COUNT can route each escrow
    expect(src).toContain("tokenProgram0: Account");
    expect(src).toContain("tokenProgram1: Account");
    expect(src).toContain("tp0 = 0 < SETTLE_SPL_COUNT ? tokenProgram0 : tokenProgram1");
  });

  it("escrowCount is validated", () => {
    for (const bad of [0, -1, 1.5, SVM_MAX_ESCROWS + 1]) {
      expect(() => svmSettleSource(bad)).toThrow();
      expect(() => svmSettleRefs(bad)).toThrow();
    }
  });

  it("★ the blob is a deterministic function of (escrowCount, minOut, splCount) — and ONLY those", () => {
    // The genericity claim, restated for compile-time defines: recompiling the same three inputs
    // reproduces the bytes exactly, which is what makes "recompile and byte-compare" a valid check.
    // Every ACCOUNT identity is an attach slot and never enters the bytecode, so one blob still
    // serves every mint/recipient/owner — that is what the manifest above is for.
    //
    // Two calls back to back cannot fail this short of nondeterminism, so the recompile happens AFTER
    // four other triples have gone through the compiler: the wasm module is one long-lived instance
    // shared by every compile in the process, so the real risk is a previous compile leaking into the
    // next one, not a call disagreeing with itself.
    const first = hex(partnerCompile(3, 12345n, 2n).bytecode);
    const others: [number, bigint, bigint][] = [
      [2, 1n, 0n],
      [5, 0n, 5n],
      [1, 1n << 200n, 1n],
      [3, 999n, 2n],
    ];
    for (const [n, minOut, splCount] of others) partnerCompile(n, minOut, splCount);

    expect(hex(partnerCompile(3, 12345n, 2n).bytecode)).toBe(first);
    // ...and the source it compiles is itself a pure function of the escrow count, which is the other
    // half of "a function of the triple": a generator that varied would break the pin without the
    // compiler moving at all.
    expect(svmSettleSource(3)).toBe(svmSettleSource(3));
  });

  it("★ ...and it is SENSITIVE to each of them — so a byte-match pins all three", () => {
    const base = hex(partnerCompile(3, 12345n, 2n).bytecode);
    expect(hex(partnerCompile(3, 999n, 2n).bytecode)).not.toBe(base); // minOut
    expect(hex(partnerCompile(3, 12345n, 1n).bytecode)).not.toBe(base); // splCount
    expect(hex(partnerCompile(2, 12345n, 2n).bytecode)).not.toBe(base); // escrowCount
  });
});

describe("svm settle — the shipped program source", () => {
  it("svmSettleSource(1) returns the exact on-disk settle.sauce.ts", () => {
    const onDisk = readFileSync(resolve(process.cwd(), "src/svm/recipes/settle.sauce.ts"), "utf-8");
    expect(svmSettleSource(1)).toBe(onDisk);
  });
});

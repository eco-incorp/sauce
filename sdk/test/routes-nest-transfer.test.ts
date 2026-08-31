/**
 * routes/nest.ts — TRANSFER-mode nesting codegen (2026-08-11 directive: the DEFAULT mechanism, opt-in
 * here at the pure-module level via `via: "transfer"` — the pure module's OWN default stays
 * `"publishAndFund"`, see `nest.ts`'s `NestVia` doc).
 *
 * Pure: hand-built `Intent`s + text assertions, plus a real `compile()` proof that the emitted
 * program actually compiles at `target: 'v12'` (no network, no anvil).
 */
import { compile } from "@eco-incorp/sauce-compiler";
import { hexToBytes, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { hashIntent } from "../src/routes/encode.js";
import {
  assertNestingInvariants,
  nestedTransferProgram,
  nestedTransferStatements,
  type TransferChildOptions,
  type TransferNestEntry,
} from "../src/routes/nest.js";
import { intentVaultAddressCall } from "../src/routes/portal.js";
import { predictVaultAddress } from "../src/routes/vault.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { TOKEN_BASE_DIRS } from "../src/token/source.js";
import type { Intent, Route, UniversalAddress } from "../src/routes/types.js";

const evmAddr = (byte: string): UniversalAddress => toUniversalAddress(("0x" + byte.repeat(20)) as Hex);

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");

const PARENT_PORTAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const CHILD_ROUTE_PORTAL = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const VAULT = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const TOKEN_A = evmAddr("77");
const TOKEN_B = evmAddr("88");

function parentRoute(overrides: Partial<Route> = {}): Route {
  return normalizeRoute({
    deadline: 1000n,
    portal: PARENT_PORTAL,
    nativeAmount: 0n,
    tokens: [],
    calls: [],
    ...overrides,
  });
}

function childIntent(overrides: Partial<Intent> = {}, saltByte = "01"): Intent {
  return {
    destination: BigInt(ARBITRUM.id),
    sourceChainId: BigInt(BASE.id), // parent's destination chain
    route: normalizeRoute({
      salt: ("0x" + saltByte.repeat(32)) as Hex,
      deadline: 1000n,
      portal: CHILD_ROUTE_PORTAL,
      calls: [],
    }),
    reward: normalizeReward({
      deadline: 1000n,
      creator: CREATOR,
      prover: PROVER,
      nativeAmount: 0n,
      tokens: [],
    }),
    ...overrides,
  };
}

const explicitOpts: TransferChildOptions = { vaultResolution: { mode: "explicit", vault: VAULT } };

describe("nest.ts: nestedTransferStatements — text shape", () => {
  it("1-token child: balanceOf, clamp ternary, zero-guard, transfer to the vault", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 500n }] }),
    });
    const stmts = nestedTransferStatements(child, 0, explicitOpts);

    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(VAULT)}n;`);
    expect(stmts[1]).toBe(`const n0_bal0 = IERC20.at(${BigInt(TOKEN_A)}n).balanceOf(ctx.self());`);
    expect(stmts[2]).toBe(`const n0_amt0 = n0_bal0 > 500n ? 500n : n0_bal0;`);
    expect(stmts[3]).toBe(`if (n0_amt0 > 0n) { IERC20.at(${BigInt(TOKEN_A)}n).transfer(n0_vault, n0_amt0); }`);
    expect(stmts).toHaveLength(4);
  });

  it("clamp:false drops the ternary and transfers the raw balance", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 500n }] }),
    });
    const stmts = nestedTransferStatements(child, 0, { ...explicitOpts, clamp: false });

    expect(stmts.some((s) => s.includes("n0_amt0"))).toBe(false);
    expect(stmts[stmts.length - 1]).toBe(`if (n0_bal0 > 0n) { IERC20.at(${BigInt(TOKEN_A)}n).transfer(n0_vault, n0_bal0); }`);
  });

  it("requireCap:true inserts the underfunded throw before the clamp", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 500n }] }),
    });
    const stmts = nestedTransferStatements(child, 0, { ...explicitOpts, requireCap: true });

    expect(stmts[2]).toBe(`if (n0_bal0 < 500n) { throw 'nest: child underfunded'; }`);
    expect(stmts[3]).toBe(`const n0_amt0 = n0_bal0 > 500n ? 500n : n0_bal0;`);
  });

  it("a native-declaring child gets the native leg; a non-native child does not", () => {
    const nativeChild = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, nativeAmount: 77n, tokens: [] }),
    });
    const stmts = nestedTransferStatements(nativeChild, 0, explicitOpts);
    expect(stmts).toEqual([
      `const n0_vault = ${BigInt(VAULT)}n;`,
      `const n0_nbal = ctx.selfBalance();`,
      `const n0_namt = n0_nbal > 77n ? 77n : n0_nbal;`,
      `if (n0_namt > 0n) { contract.call(n0_vault, n0_namt, Uint8Array.from([])); }`,
    ]);

    const tokenOnlyChild = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 1n }] }),
    });
    const stmts2 = nestedTransferStatements(tokenOnlyChild, 0, explicitOpts);
    expect(stmts2.some((s) => s.includes("ctx.selfBalance()"))).toBe(false);
  });

  it("native: 'skip' suppresses the native leg even for a native-declaring child", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 77n,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, { ...explicitOpts, native: "skip" });
    expect(stmts.some((s) => s.includes("ctx.selfBalance()"))).toBe(false);
    expect(stmts.some((s) => s.includes("IERC20"))).toBe(true);
  });

  it("T1: throws for a genuinely empty reward (no tokens, nativeAmount 0)", () => {
    const child = childIntent();
    expect(() => nestedTransferStatements(child, 0, explicitOpts)).toThrow(/empty|publishAndFund/i);
  });

  it("native: 'skip' with an all-native, zero-token reward yields no statements (no error)", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, nativeAmount: 5n, tokens: [] }),
    });
    expect(nestedTransferStatements(child, 0, { ...explicitOpts, native: "skip" })).toEqual([]);
  });

  it("T2: a non-EVM-representable reward token throws (denormalizeToEvm's own named error)", () => {
    const svmToken = toUniversalAddress(("0x" + "22".repeat(32)) as Hex); // 32-byte, nonzero high bytes
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: svmToken, amount: 1n }] }),
    });
    expect(() => nestedTransferStatements(child, 0, explicitOpts)).toThrow(/EVM-representable/i);
  });
});

describe("nest.ts: vault-address resolution rungs", () => {
  it("rung A (runtime): the calldata literal equals intentVaultAddressCall's own data, byte-for-byte", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 1n }] }),
    });
    const stmts = nestedTransferStatements(child, 0, {
      vaultResolution: { mode: "runtime", portal: PARENT_PORTAL },
    });
    const vaultStmt = stmts[0]!;

    const expectedCalldata = intentVaultAddressCall(child, { portal: PARENT_PORTAL }).data;
    const expectedBytes = Array.from(hexToBytes(expectedCalldata));
    const expectedLiteral = `Uint8Array.from([${expectedBytes.join(", ")}])`;

    expect(vaultStmt).toBe(
      `const n0_vault = abi.decode(contract.static(${BigInt(PARENT_PORTAL)}n, ${expectedLiteral}), "address");`,
    );
    // the staticcall target is the PARENT's own portal — never the child's route.portal, nor a vault.
    expect(vaultStmt).toContain(`${BigInt(PARENT_PORTAL)}n`);
    expect(vaultStmt).not.toContain(`${BigInt(CHILD_ROUTE_PORTAL)}n`);
  });

  it("rung B (predicted): the baked address equals predictVaultAddress's own output", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 1n }] }),
    });
    const vaultInitCodeHash = ("0x" + "ab".repeat(32)) as Hex;
    const stmts = nestedTransferStatements(child, 0, {
      vaultResolution: { mode: "predicted", config: { portal: PARENT_PORTAL, vaultInitCodeHash } },
    });
    const expected = predictVaultAddress(hashIntent(child).intentHash, { portal: PARENT_PORTAL, vaultInitCodeHash });
    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(expected)}n;`);
  });

  it("rung C (explicit): bakes the given address verbatim", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 1n }] }),
    });
    const stmts = nestedTransferStatements(child, 0, explicitOpts);
    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(VAULT)}n;`);
  });
});

describe("nest.ts: nestedTransferProgram — real compile() proof", () => {
  it("a 1-token, 1-child program compiles at target 'v12'", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 500n }] }),
    });
    const { source, baseDirs, imports } = nestedTransferProgram([{ child, opts: explicitOpts }]);
    expect(imports).toEqual([expect.stringContaining("IERC20")]);
    expect(baseDirs.length).toBeGreaterThan(0);

    const result = compile(source, { target: "v12", baseDirs: [...baseDirs] });
    expect(result.bytecode.length).toBeGreaterThan(0);
    expect(result.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("2 children x 2 tokens merge into one program with no duplicate-declaration collision", () => {
    const childA = childIntent(
      {
        reward: normalizeReward({
          deadline: 1000n,
          creator: CREATOR,
          prover: PROVER,
          nativeAmount: 3n,
          tokens: [
            { token: TOKEN_A, amount: 500n },
            { token: TOKEN_B, amount: 700n },
          ],
        }),
      },
      "01",
    );
    const childB = childIntent(
      {
        reward: normalizeReward({
          deadline: 1000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [
            { token: TOKEN_A, amount: 200n },
            { token: TOKEN_B, amount: 300n },
          ],
        }),
      },
      "02",
    );

    const entries: TransferNestEntry[] = [
      { child: childA, opts: explicitOpts },
      { child: childB, opts: { ...explicitOpts, clamp: false } },
    ];
    const { source, baseDirs } = nestedTransferProgram(entries);

    const result = compile(source, { target: "v12", baseDirs: [...baseDirs, ...TOKEN_BASE_DIRS] });
    expect(result.bytecode.length).toBeGreaterThan(0);
    // sanity: every per-child local is namespaced by index, so no `already declared` collision.
    expect(source).toContain("n0_vault");
    expect(source).toContain("n1_vault");
    expect(source.match(/const n0_vault/g)?.length).toBe(1);
    expect(source.match(/const n1_vault/g)?.length).toBe(1);
  });

  it("a native-only, no-token program needs no IERC20 import and still compiles", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, nativeAmount: 9n, tokens: [] }),
    });
    const { source, imports, baseDirs } = nestedTransferProgram([{ child, opts: explicitOpts }]);
    expect(imports).toEqual([]);
    expect(baseDirs).toEqual([]);
    const result = compile(source, { target: "v12" });
    expect(result.bytecode.length).toBeGreaterThan(0);
  });
});

describe("nest.ts: assertNestingInvariants — via:'transfer' drops invariant 5", () => {
  it("a transfer child EXCEEDING the parent's route.tokens builds fine (dropped invariant 5)", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 100n }],
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ tokens: [{ token: TOKEN_A, amount: 10n }] }), // far less than the child's cap
        children: [{ intent: child, via: "transfer" }],
      }),
    ).not.toThrow();
  });

  it("the SAME shape still throws under via:'publishAndFund' (the dropped-invariant control)", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 100n }],
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ tokens: [{ token: TOKEN_A, amount: 10n }] }),
        children: [{ intent: child, via: "publishAndFund" }],
      }),
    ).toThrow(/token/i);
  });

  it("an unspecified `via` still defaults to publishAndFund semantics (pure-module default unchanged)", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, nativeAmount: 100n, tokens: [] }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ nativeAmount: 0n }),
        children: [{ intent: child }], // no `via` given
      }),
    ).toThrow(/nativeAmount/);
  });

  it("invariants 1/2/4/6 still apply to a transfer child (only 5 is dropped)", () => {
    const lateChild = childIntent({
      route: normalizeRoute({ salt: ("0x" + "05".repeat(32)) as Hex, deadline: 500n, portal: CHILD_ROUTE_PORTAL }),
      reward: normalizeReward({ deadline: 1000n, creator: CREATOR, prover: PROVER, tokens: [{ token: TOKEN_A, amount: 1n }] }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ deadline: 1000n }),
        children: [{ intent: lateChild, via: "transfer" }],
      }),
    ).toThrow(/deadline/i);
  });
});

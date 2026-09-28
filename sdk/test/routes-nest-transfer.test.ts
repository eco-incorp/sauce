/**
 * routes/nest.ts — TRANSFER-mode nesting codegen (2026-08-11 directive: the DEFAULT mechanism, opt-in
 * here at the pure-module level via `via: "transfer"` — the pure module's OWN default stays
 * `"publishAndFund"`, see `nest.ts`'s `NestVia` doc).
 *
 * Pure: hand-built `Intent`s + text assertions, plus a real `compile()` proof that the emitted
 * program actually compiles (no network, no anvil).
 */
import { compileProgram as compile } from "./helpers";
import type { Hex } from "viem";

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
import { openRoute } from "../src/routes/intent-dsl.js";
import { predictVaultAddress } from "../src/routes/vault.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { TOKEN_BASE_DIRS } from "../src/token/source.js";
import type { Intent, Route, UniversalAddress } from "../src/routes/types.js";

const evmAddr = (byte: string): UniversalAddress =>
  toUniversalAddress(("0x" + byte.repeat(20)) as Hex);

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

describe("nest.ts: default fluent transfer mode compiles with runtime vault lookup", () => {
  it.each(["ERC20", "native"] as const)("funds a %s child without an explicit vault", (asset) => {
    const child = openRoute("arbitrum", "return 1n;", {
      pot: VAULT,
      engine: PROVER,
      portal: CHILD_ROUTE_PORTAL,
      deadline: 2000n,
    }).reward({
      source: "base",
      creator: CREATOR,
      prover: PROVER,
      deadline: 2000n,
      ...(asset === "ERC20" ? { tokens: [{ token: TOKEN_A, amount: 5n }] } : { nativeAmount: 5n }),
    });

    // No nest options: this must compile the default transfer program and query the Portal for
    // its vault, rather than using the explicit-vault shortcut the earlier compile tests covered.
    const built = openRoute("base", "return 1n;", {
      pot: VAULT,
      engine: PROVER,
      portal: PARENT_PORTAL,
      deadline: 1000n,
    })
      .nest(child)
      .reward({
        source: "ethereum",
        creator: CREATOR,
        prover: PROVER,
        deadline: 2000n,
        nativeAmount: 1n,
      });

    expect(built.children).toEqual([child]);
    expect(built.intent.route.calls).toHaveLength(2);
    expect(built.intent.route.calls[1]!.data.length).toBeGreaterThan(2);
  });
});

describe("nest.ts: nestedTransferStatements — text shape", () => {
  it("1-token child: balanceOf, clamp ternary, zero-guard, transfer to the vault", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 500n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, explicitOpts);

    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(VAULT)}n;`);
    expect(stmts[1]).toBe(`const n0_bal0 = IERC20.at(${BigInt(TOKEN_A)}n).balanceOf(ctx.self());`);
    expect(stmts[2]).toBe(`const n0_amt0 = n0_bal0 > 500n ? 500n : n0_bal0;`);
    // The transfer is a raw `evm.call` with no declared output -- the vendored IERC20 declares a
    // `bool` the compiler decodes even when discarded, which reverts on a no-return token (USDT).
    // The calldata const is hoisted out of the zero-guard.
    expect(stmts[3]).toBe("const n0_0_tr0 = hex`a9059cbb`;");
    // The call AND its SafeERC20 check sit inside the zero guard -- checking a call that never ran
    // would read a stale result. See `token/safe.ts`.
    expect(stmts[4]).toContain("if (n0_amt0 > 0n) { const n0_0_tr = evm.call(");
    expect(stmts[4]).toContain("require(ctx.codeSize(");
    expect(stmts[4]).toContain("require(n0_0_tr.toBe() == 1); } }");
    expect(stmts).toHaveLength(5);
  });

  it("clamp:false drops the ternary and transfers the raw balance", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 500n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, { ...explicitOpts, clamp: false });

    expect(stmts.some((s) => s.includes("n0_amt0"))).toBe(false);
    expect(stmts[stmts.length - 1]).toContain("if (n0_bal0 > 0n) { const n0_0_tr = evm.call(");
    expect(stmts[stmts.length - 1]).toContain("n0_bal0.toBytesBe(32)");
  });

  it("requireCap:true inserts the underfunded throw before the clamp", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 500n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, { ...explicitOpts, requireCap: true });

    expect(stmts[2]).toBe(`if (n0_bal0 < 500n) { throw 'nest: child underfunded'; }`);
    expect(stmts[3]).toBe(`const n0_amt0 = n0_bal0 > 500n ? 500n : n0_bal0;`);
  });

  it("a native-declaring child gets the native leg; a non-native child does not", () => {
    const nativeChild = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 77n,
        tokens: [],
      }),
    });
    const stmts = nestedTransferStatements(nativeChild, 0, explicitOpts);
    expect(stmts).toEqual([
      `const n0_vault = ${BigInt(VAULT)}n;`,
      `const n0_nbal = ctx.selfBalance();`,
      `const n0_namt = n0_nbal > 77n ? 77n : n0_nbal;`,
      "const n0_ndata = hex``;",
      `if (n0_namt > 0n) { evm.call(n0_vault, n0_namt, n0_ndata); }`,
    ]);

    const tokenOnlyChild = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
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
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 5n,
        tokens: [],
      }),
    });
    expect(nestedTransferStatements(child, 0, { ...explicitOpts, native: "skip" })).toEqual([]);
  });

  it("T2: a non-EVM-representable reward token throws (denormalizeToEvm's own named error)", () => {
    const svmToken = toUniversalAddress(("0x" + "22".repeat(32)) as Hex); // 32-byte, nonzero high bytes
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: svmToken, amount: 1n }],
      }),
    });
    expect(() => nestedTransferStatements(child, 0, explicitOpts)).toThrow(/EVM-representable/i);
  });
});

describe("nest.ts: vault-address resolution rungs", () => {
  it("rung A (runtime): the calldata literal equals intentVaultAddressCall's own data, byte-for-byte", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, {
      vaultResolution: { mode: "runtime", portal: PARENT_PORTAL },
    });
    const vaultStmt = stmts[0]!;

    const expectedCalldata = intentVaultAddressCall(child, { portal: PARENT_PORTAL }).data;
    const expectedLiteral = `hex\`${expectedCalldata.slice(2)}\``;

    expect(vaultStmt).toBe(
      `const n0_vault = abi.decode(evm.static(${BigInt(PARENT_PORTAL)}n, ${expectedLiteral}), ["Address"])[0];`,
    );
    // the staticcall target is the PARENT's own portal — never the child's route.portal, nor a vault.
    expect(vaultStmt).toContain(`${BigInt(PARENT_PORTAL)}n`);
    expect(vaultStmt).not.toContain(`${BigInt(CHILD_ROUTE_PORTAL)}n`);
  });

  it("rung B (predicted): the baked address equals predictVaultAddress's own output", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
    });
    const vaultInitCodeHash = ("0x" + "ab".repeat(32)) as Hex;
    const stmts = nestedTransferStatements(child, 0, {
      vaultResolution: { mode: "predicted", config: { portal: PARENT_PORTAL, vaultInitCodeHash } },
    });
    const expected = predictVaultAddress(hashIntent(child).intentHash, {
      portal: PARENT_PORTAL,
      vaultInitCodeHash,
    });
    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(expected)}n;`);
  });

  it("rung C (explicit): bakes the given address verbatim", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
    });
    const stmts = nestedTransferStatements(child, 0, explicitOpts);
    expect(stmts[0]).toBe(`const n0_vault = ${BigInt(VAULT)}n;`);
  });
});

describe("nest.ts: nestedTransferProgram — real compile() proof", () => {
  it("a 1-token, 1-child program compiles", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 500n }],
      }),
    });
    const { source, baseDirs, imports } = nestedTransferProgram([{ child, opts: explicitOpts }]);
    expect(imports).toEqual([expect.stringContaining("IERC20")]);
    expect(baseDirs.length).toBeGreaterThan(0);

    const result = compile(source, { baseDirs: [...baseDirs] });
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

    const result = compile(source, { baseDirs: [...baseDirs, ...TOKEN_BASE_DIRS] });
    expect(result.bytecode.length).toBeGreaterThan(0);
    // sanity: every per-child local is namespaced by index, so no `already declared` collision.
    expect(source).toContain("n0_vault");
    expect(source).toContain("n1_vault");
    expect(source.match(/const n0_vault/g)?.length).toBe(1);
    expect(source.match(/const n1_vault/g)?.length).toBe(1);
  });

  it("a native-only, no-token program needs no IERC20 import and still compiles", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 9n,
        tokens: [],
      }),
    });
    const { source, imports, baseDirs } = nestedTransferProgram([{ child, opts: explicitOpts }]);
    expect(imports).toEqual([]);
    expect(baseDirs).toEqual([]);
    const result = compile(source);
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
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 100n,
        tokens: [],
      }),
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
      route: normalizeRoute({
        salt: ("0x" + "05".repeat(32)) as Hex,
        deadline: 500n,
        portal: CHILD_ROUTE_PORTAL,
      }),
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: TOKEN_A, amount: 1n }],
      }),
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

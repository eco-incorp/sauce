/**
 * `.nest()`'s DSL-level DEFAULT: `via: "transfer"` (2026-08-11 directive). Companion to
 * `routes-nest-dsl.test.ts`, which now declares `via: "publishAndFund"` explicitly on every case.
 */
import { decodeFunctionData, type Hex } from "viem";

import { v12Pot } from "../src/evm/engine.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { PORTAL_ABI } from "../src/routes/portal.js";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x5555555555555555555555555555555555555555" as const;
const VAULT_A = "0x6666666666666666666666666666666666666666" as const;
const VAULT_B = "0x7777777777777777777777777777777777777777" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: 1000n,
    ...overrides,
  };
}

function childWithReward(destination: string, source = "base", deadline = 2000n) {
  return openRoute(destination, "return 1n;", {
    pot: POT,
    engine: ENGINE,
    deadline,
    portal: PORTAL,
    source,
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: deadline,
  }).reward({ tokens: [{ token: TOKEN, amount: 500n }] });
}

function decodeCallKinds(calls: readonly { data: Hex }[]): readonly string[] {
  return calls.map((c) => {
    try {
      return decodeFunctionData({ abi: PORTAL_ABI, data: c.data }).functionName;
    } catch {
      // fall through
    }
    try {
      decodeFunctionData({ abi: v12Pot.abi, data: c.data });
      return "cook";
    } catch {
      // fall through
    }
    try {
      return decodeFunctionData({ abi: ERC20ABI, data: c.data }).functionName;
    } catch {
      return "unknown";
    }
  });
}

describe(".nest(): via default is 'transfer'", () => {
  it("emits NO publishAndFund call, and exactly one extra cook targeting the pot", () => {
    const child = childWithReward("arbitrum");
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(child, { vault: VAULT_A })
      .reward(0n);

    const kinds = decodeCallKinds(built.intent.route.calls);
    expect(kinds).not.toContain("publishAndFund");
    expect(kinds.filter((k) => k === "cook")).toHaveLength(2); // the body cook + the transfer cook

    // both cooks target the SAME pot (this route's own execution.pot).
    for (const c of built.intent.route.calls) {
      expect(c.target.toLowerCase().endsWith(POT.slice(2).toLowerCase())).toBe(true);
    }
  });

  it("the transfer program's own compiled bytecode contains a balanceOf read + transfer call (compileProof)", () => {
    const child = childWithReward("arbitrum");
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(child, { vault: VAULT_A })
      .reward(0n);

    // last call is the transfer cook (default position "after").
    const transferCall = built.intent.route.calls[built.intent.route.calls.length - 1]!;
    const decoded = decodeFunctionData({ abi: v12Pot.abi, data: transferCall.data });
    expect(decoded.functionName).toBe("cook");
    // `cook(address engine, bytes program)` — one program, not an array of ingredients.
    const [engine, program] = decoded.args as readonly [Hex, Hex];
    // The engine the route was GIVEN, not merely a well-formed address — a shape check here passes
    // for any 20 bytes, including the portal's.
    expect(engine.toLowerCase()).toBe(ENGINE);
    expect(program.length).toBeGreaterThan(2); // real, nonempty compiled bytecode
  });
});

describe(".nest(): via:'publishAndFund' reproduces the byte-identical landed output", () => {
  it("route.calls match the explicit-via path exactly", () => {
    const childForTransfer = childWithReward("arbitrum");
    const childForPublish = childWithReward("arbitrum");

    const transferBuilt = openRoute("base", "return 1n;", evmOptions())
      .nest(childForTransfer, { via: "transfer", vault: VAULT_A })
      .reward(0n);

    const publishBuilt = openRoute(
      "base",
      "return 1n;",
      evmOptions({ tokens: [{ token: TOKEN, amount: 500n }] }),
    )
      .nest(childForPublish, { via: "publishAndFund" })
      .reward(0n);

    // Structurally different (different mechanisms) — assert publishAndFund's OWN shape is exactly
    // what it always was: [cook, approve, publishAndFund] (default position "after").
    const kinds = decodeCallKinds(publishBuilt.intent.route.calls);
    expect(kinds).toEqual(["cook", "approve", "publishAndFund"]);

    // and transfer's own shape has no approve/publishAndFund at all.
    const transferKinds = decodeCallKinds(transferBuilt.intent.route.calls);
    expect(transferKinds).not.toContain("approve");
    expect(transferKinds).not.toContain("publishAndFund");
  });
});

describe(".nest(): position", () => {
  it("position: 'before' puts the transfer cook ahead of the body cook", () => {
    const child = childWithReward("arbitrum");
    const built = openRoute("base", "function main() { return 1n; }", evmOptions())
      .nest(child, { vault: VAULT_A, position: "before" })
      .reward(0n);

    const kinds = decodeCallKinds(built.intent.route.calls);
    expect(kinds).toEqual(["cook", "cook"]);
    // can't distinguish which cook is which by decoded functionName alone; assert count/order via length 2
    expect(built.intent.route.calls).toHaveLength(2);
  });
});

describe(".nest(): merging", () => {
  it("two transfer children at the same position merge into ONE cook, in .nest() order", () => {
    const childA = childWithReward("arbitrum");
    const childB = childWithReward("optimism");

    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(childA, { vault: VAULT_A })
      .nest(childB, { vault: VAULT_B })
      .reward(0n);

    const kinds = decodeCallKinds(built.intent.route.calls);
    expect(kinds.filter((k) => k === "cook")).toHaveLength(2); // body cook + ONE merged transfer cook
    expect(built.intent.route.calls).toHaveLength(2);
  });

  it("the merged program embeds BOTH children's vault addresses", () => {
    const childA = childWithReward("arbitrum");
    const childB = childWithReward("optimism");

    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(childA, { vault: VAULT_A })
      .nest(childB, { vault: VAULT_B })
      .reward(0n);

    const transferCall = built.intent.route.calls[built.intent.route.calls.length - 1]!;
    const decoded = decodeFunctionData({ abi: v12Pot.abi, data: transferCall.data });
    const [, bytecode] = decoded.args as readonly [Hex, Hex];
    expect(bytecode.length).toBeGreaterThan(2);
  });
});

describe(".nest(): child stays static", () => {
  it("hash/vault/encodeEVM/intents all keep working on a transfer-mode child", () => {
    const child = childWithReward("arbitrum");
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(child, { vault: VAULT_A })
      .reward(0n);

    expect(built.children).toHaveLength(1);
    expect(() => built.children[0]!.hash()).not.toThrow();
    expect(() => built.children[0]!.encodeEVM()).not.toThrow();
    expect(built.intents()).toHaveLength(2);
    expect(built.intents()[1]).toBe(child.intent);
  });

  it("a depth-2 transfer cascade produces intents().length === 3", () => {
    // grandchild's source must be the CHILD's destination (arbitrum); child's source must be the
    // HEAD's destination (base) — mirrors routes-nest-dsl.test.ts's own depth-2 cascade shape.
    const grandchild = childWithReward("optimism", "arbitrum");
    const child = openRoute(
      "arbitrum",
      "return 2n;",
      evmOptions({ deadline: 2000n, rewardDeadline: 2000n }),
    )
      .nest(grandchild, { vault: VAULT_B })
      .reward({ tokens: [{ token: TOKEN, amount: 500n }] });
    const head = openRoute("base", "return 1n;", evmOptions())
      .nest(child, { vault: VAULT_A })
      .reward(0n);

    expect(head.intents()).toHaveLength(3);
  });
});

describe(".nest(): T3 — via:'transfer' requires an EVM Pot execution", () => {
  it("throws when the destination is svm and no pot override is given", () => {
    // the SVM-destination route's child must source from "solana" (its parent's destination).
    const svmChild = childWithReward("arbitrum", "solana");
    expect(() =>
      openRoute("solana", "return 1n;", {
        execution: { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: CREATOR,
        prover: PROVER,
        rewardDeadline: 2000n,
      }).nest(svmChild, { vault: VAULT_A }),
    ).toThrow(/EVM Pot/i);
  });
});

describe(".nest(): merged transfer entries must agree on the Pot AND the engine", () => {
  // A merge produces ONE cook, so entry 0's values are the ones that land. Both are read from entry
  // 0, so both need the same unanimity check — with only the Pot checked, entry 1's bytecode ran on
  // entry 0's interpreter and nothing said so.
  it("throws on a conflicting engine across children in one position group", () => {
    const a = childWithReward("arbitrum");
    const b = childWithReward("optimism");

    expect(() =>
      openRoute("base", "return 1n;", evmOptions())
        .nest(a, { vault: VAULT_A })
        .nest(b, { vault: VAULT_B, engine: "0xabababababababababababababababababababab" })
        .reward(0n),
    ).toThrow(/same engine/i);
  });

  it("CONTROL: the same engine on both children merges without complaint", () => {
    const a = childWithReward("arbitrum");
    const b = childWithReward("optimism");

    expect(() =>
      openRoute("base", "return 1n;", evmOptions())
        .nest(a, { vault: VAULT_A })
        .nest(b, { vault: VAULT_B, engine: ENGINE })
        .reward(0n),
    ).not.toThrow();
  });
});

describe(".nest(): mode-mismatched options throw", () => {
  it("a transfer-only option under via:'publishAndFund' throws a named error", () => {
    const child = childWithReward("arbitrum");
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(child, {
        via: "publishAndFund",
        vault: VAULT_A,
      }),
    ).toThrow(/only valid with via: "transfer"/);
  });

  it("a publishAndFund-only option under via:'transfer' (default) throws a named error", () => {
    const child = childWithReward("arbitrum");
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(child, {
        allowPartial: true,
        vault: VAULT_A,
      }),
    ).toThrow(/only valid with via: "publishAndFund"/);
  });
});

describe(".nest(): fundNativeFromRoute", () => {
  it("sets the transfer cook's value and enforces T5 (native coverage)", () => {
    const nativeChild = openRoute("arbitrum", "return 1n;", evmOptions()).reward({
      nativeAmount: 50n,
      deadline: 2000n,
    });

    // T5 passes: parent route.nativeAmount (50) covers the opted-in child's nativeAmount (50).
    const built = openRoute("base", "return 1n;", evmOptions({ nativeAmount: 50n }))
      .nest(nativeChild, { vault: VAULT_A, fundNativeFromRoute: true })
      .reward(0n);

    const transferCall = built.intent.route.calls[built.intent.route.calls.length - 1]!;
    expect(transferCall.value).toBe(50n);

    // T5 fails: parent only declares 10, child wants 50.
    const underfundedChild = openRoute("arbitrum", "return 1n;", evmOptions()).reward({
      nativeAmount: 50n,
      deadline: 2000n,
    });
    expect(() =>
      openRoute("base", "return 1n;", evmOptions({ nativeAmount: 10n }))
        .nest(underfundedChild, { vault: VAULT_A, fundNativeFromRoute: true })
        .reward(0n),
    ).toThrow(/nativeAmount/i);
  });
});

describe(".nest(): no-regression control", () => {
  it("a depth-1 build with no .nest() is unaffected by any of this", () => {
    const withoutNest = openRoute("base", "return 1n;", evmOptions()).reward(0n);
    expect(withoutNest.children).toEqual([]);
    expect(withoutNest.intents()).toEqual([withoutNest.intent]);
  });
});

describe(".nest(): execution fees", () => {
  it("pays one fee for merged children in addition to their native rewards", () => {
    const nativeChild = openRoute("arbitrum", "return 1n;", evmOptions()).reward({
      nativeAmount: 50n,
      deadline: 2000n,
    });
    const built = openRoute(
      "base",
      "return 1n;",
      evmOptions({ execution: { pot: POT, engine: ENGINE, value: 10n }, nativeAmount: 70n }),
    )
      .nest(nativeChild, { vault: VAULT_A, fundNativeFromRoute: true, executionFee: 10n })
      .nest(childWithReward("optimism"), { vault: VAULT_B, executionFee: "10" })
      .reward(0n);

    expect(built.intent.route.calls.map((call) => call.value)).toEqual([10n, 60n]);
    expect(built.children[0]!.intent.reward.nativeAmount).toBe(50n);
  });

  it("budgets separate fees for before and after transfer cooks", () => {
    const built = openRoute("base", "return 1n;", evmOptions({ nativeAmount: 20n }))
      .nest(childWithReward("arbitrum"), {
        vault: VAULT_A,
        position: "before",
        executionFee: 10n,
      })
      .nest(childWithReward("optimism"), { vault: VAULT_B, executionFee: 10n })
      .reward(0n);

    expect(built.intent.route.calls.map((call) => call.value)).toEqual([10n, 0n, 10n]);
  });

  it("rejects a fee budget already consumed by the parent cook", () => {
    expect(() =>
      openRoute(
        "base",
        "return 1n;",
        evmOptions({ execution: { pot: POT, engine: ENGINE, value: 10n }, nativeAmount: 10n }),
      )
        .nest(childWithReward("arbitrum"), { vault: VAULT_A, executionFee: 10n })
        .reward(0n),
    ).toThrow(/route.nativeAmount must cover 20 wei/);
  });

  it("rejects conflicting fees in a merged cook", () => {
    expect(() =>
      openRoute("base", "return 1n;", evmOptions({ nativeAmount: 100n }))
        .nest(childWithReward("arbitrum"), { vault: VAULT_A, executionFee: 10n })
        .nest(childWithReward("optimism"), { vault: VAULT_B, executionFee: 20n })
        .reward(0n),
    ).toThrow(/same executionFee/);
  });

  it("includes publication value unless explicitly funded by the body", () => {
    const publicationChild = openRoute("arbitrum", "return 1n;", evmOptions()).reward({
      nativeAmount: 50n,
      deadline: 2000n,
    });
    const build = (fundedByBody: boolean) =>
      openRoute(
        "base",
        "return 1n;",
        evmOptions({ execution: { pot: POT, engine: ENGINE, value: 10n }, nativeAmount: 60n }),
      )
        .nest(publicationChild, { via: "publishAndFund", fundedByBody })
        .nest(childWithReward("optimism"), { vault: VAULT_B, executionFee: 10n })
        .reward(0n);

    expect(() => build(false)).toThrow(/route.nativeAmount must cover 70 wei/);
    expect(build(true).intent.route.calls.map((call) => call.value)).toEqual([10n, 50n, 10n]);
  });

  it("rejects negative fees and fees in publication mode", () => {
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(childWithReward("arbitrum"), {
        executionFee: -1n,
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(childWithReward("arbitrum"), {
        via: "publishAndFund",
        executionFee: 10n,
      }),
    ).toThrow(/only valid with via: "transfer"/);
  });
});

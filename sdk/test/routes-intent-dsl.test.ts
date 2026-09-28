/**
 * Cross-chain intent DSL — chain-global contract tests.
 *
 * `Base(sauce, opts).reward(rewardArg)` (identically `Base.route(sauce, opts).reward(rewardArg)`)
 * compiles a Sauce route body for the destination chain and slots it into a V2 `Intent`, reusing the
 * EXISTING encode/hash/normalize machinery unchanged.
 */
import { address } from "@solana/kit";
import { bytesToHex, getAddress, getCreate2Address, keccak256, type Hex } from "viem";

import { chainAccessors } from "../src/routes/accessors.js";
import { requireChain } from "../src/chains/canonical.js";
import {
  encodeRewardEvm,
  encodeRewardSvm,
  encodeRouteEvm,
  encodeRouteSvm,
  hashIntent,
} from "../src/routes/encode.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import { buildSauceSvmCall } from "../src/routes/sauce-calls.js";
import { compileSauceRoute, wrapSauceBody } from "../src/routes/sauce-route.js";
import { predictVaultAddress } from "../src/routes/vault.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import {
  approvalTxs,
  fundTx,
  intentHashCall,
  intentVaultAddressCall,
  isIntentFundedCall,
  publishAndFundTx,
  publishTx,
} from "../src/routes/portal.js";
import type { RewardInput, RouteInput } from "../src/routes/types.js";
import { v12Pot } from "../src/evm/engine.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;

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

describe("openRoute: EVM happy path", () => {
  it("compiles the route body and slots exactly one cook() call", () => {
    const built = openRoute("ethereum", "function main() { return 1n; }", evmOptions()).reward(0n);

    expect(built.intent.route.calls).toHaveLength(1);
    const call = built.intent.route.calls[0]!;
    expect(call.value).toBe(0n);

    expect(built.compiled.bytecode.length).toBe(1);
    // The engine is the caller's — nothing defaults it — so the expectation names the same one the
    // route was given.
    const expectedData = v12Pot.encodeCook(ENGINE, bytesToHex(built.compiled.bytecode[0]!));
    expect(call.data).toBe(expectedData);
  });
});

describe("openRoute: bare-body wrapping", () => {
  it("wraps a bare body into byte-identical bytecode as the explicit main() form", () => {
    const explicit = compileSauceRoute("ethereum", "function main() { let x = 1n; return x; }", {
      pot: POT,
      engine: ENGINE,
    });
    const bare = compileSauceRoute("ethereum", "let x = 1n; return x;", {
      pot: POT,
      engine: ENGINE,
    });

    expect(bare.compiled.bytecode.length).toBe(explicit.compiled.bytecode.length);
    for (let i = 0; i < explicit.compiled.bytecode.length; i++) {
      expect(Array.from(bare.compiled.bytecode[i]!)).toEqual(
        Array.from(explicit.compiled.bytecode[i]!),
      );
    }
  });

  it("wrapSauceBody leaves an already-complete program untouched", () => {
    const program = "function main() { return 1n; }";
    expect(wrapSauceBody(program)).toBe(program);
    expect(wrapSauceBody("return 1n;")).toBe("function main() {\nreturn 1n;\n}");
  });
});

describe("openRoute: precalls precede the compiled call", () => {
  it("keeps precalls first, in order, followed by the sauce call", () => {
    const precalls = [
      {
        target: "0x5555555555555555555555555555555555555555" as Hex,
        data: "0xaa" as Hex,
        value: 0n,
      },
      {
        target: "0x6666666666666666666666666666666666666666" as Hex,
        data: "0xbb" as Hex,
        value: 0n,
      },
    ];
    const built = openRoute("ethereum", "return 1n;", evmOptions({ precalls })).reward(0n);

    expect(built.intent.route.calls).toHaveLength(3);
    expect(built.intent.route.calls[0]!.data).toBe("0xaa");
    expect(built.intent.route.calls[1]!.data).toBe("0xbb");
  });
});

describe("openRoute: assembled intent shape", () => {
  it("destination/sourceChainId are the two chain ids; route/reward equal direct normalize calls", () => {
    const options = evmOptions({
      tokens: [{ token: "0x7777777777777777777777777777777777777777", amount: 9n }],
      nativeAmount: 3n,
    });
    const built = openRoute("ethereum", "return 1n;", options).reward({ nativeAmount: 4n });

    expect(built.intent.destination).toBe(BigInt(requireChain("ethereum").id));
    expect(built.intent.sourceChainId).toBe(BigInt(requireChain("base").id));

    const expectedRoute: RouteInput = {
      deadline: options.deadline,
      // `portal` is optional now; this fixture always sets it.
      portal: options.portal!,
      nativeAmount: options.nativeAmount,
      tokens: options.tokens,
      calls: built.intent.route.calls,
    };
    expect(built.intent.route).toEqual(normalizeRoute(expectedRoute));

    const rewardInput: RewardInput = {
      deadline: 1000n,
      creator: CREATOR,
      prover: PROVER,
      nativeAmount: 4n,
    };
    expect(built.intent.reward).toEqual(normalizeReward(rewardInput));
  });
});

describe("openRoute: hash()", () => {
  it("agrees with hashIntent, and routeHash changes when the sauce source changes", () => {
    const buildWith = (sauce: string) => openRoute("ethereum", sauce, evmOptions()).reward(0n);

    const a = buildWith("return 1n;");
    const b = buildWith("return 2n;");

    expect(a.hash()).toEqual(hashIntent(a.intent));
    expect(b.hash()).toEqual(hashIntent(b.intent));
    expect(a.hash().routeHash).not.toBe(b.hash().routeHash);
    expect(a.hash().intentHash).not.toBe(b.hash().intentHash);
  });
});

describe("openRoute: encodeEVM()/encodeSVM()", () => {
  it("equal the direct encodeRouteEvm/Svm + encodeRewardEvm/Svm calls", () => {
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(0n);

    expect(built.encodeEVM()).toEqual({
      route: encodeRouteEvm(built.intent.route),
      reward: encodeRewardEvm(built.intent.reward),
    });
    expect(built.encodeSVM()).toEqual({
      route: encodeRouteSvm(built.intent.route),
      reward: encodeRewardSvm(built.intent.reward),
    });
  });
});

describe("openRoute: SVM destination", () => {
  const BUFFER = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const ACCOUNT = address("So11111111111111111111111111111111111111112");

  it("compiles with target 'svm' and routes through buildSauceSvmCall", () => {
    const built = openRoute("solana", "function main() { return 1n; }", {
      execution: {
        code: BUFFER,
        accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
      },
      deadline: 2000n,
      portal: PORTAL,
      source: "base",
      creator: CREATOR,
      prover: PROVER,
      rewardDeadline: 1000n,
    }).reward(0n);

    expect(built.intent.route.calls).toHaveLength(1);
    const call = built.intent.route.calls[0]!;
    expect(call.value).toBe(0n);

    // A route SVM call is UNPINNED — the released engine's `execute_from_account` has no payload to
    // carry a pin — so it must equal the direct call built the same way. This assertion previously
    // sat under a comment saying the pin was injected from the compile, which made it read as a pin
    // check while proving the opposite.
    const direct = buildSauceSvmCall({
      code: BUFFER,
      accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
    });
    expect(call).toEqual(direct);
  });

  it("refuses an execution pin instead of silently dropping it", () => {
    expect(() =>
      openRoute("solana", "function main() { return 1n; }", {
        execution: {
          code: BUFFER,
          accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
          expectedSha256: new Uint8Array(32).fill(1),
        },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: CREATOR,
        prover: PROVER,
        rewardDeadline: 1000n,
      }).reward(0n),
    ).toThrow(/expectedSha256 cannot be enforced/);
  });

  it("rejects a nonzero value (SVM Call has no value field)", () => {
    expect(() =>
      openRoute("solana", "return 1n;", {
        execution: {
          code: BUFFER,
          accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
          value: 1n,
        },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: CREATOR,
        prover: PROVER,
        rewardDeadline: 1000n,
      }),
    ).toThrow(/value/i);
  });
});

describe("vault(): predictVaultAddress", () => {
  const VAULT_INIT_CODE_HASH = keccak256("0xdeadbeef") as Hex;

  it("matches viem's getCreate2Address with an explicit bytecodeHash", () => {
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(0n);

    const intentHash = built.hash().intentHash;
    const vault = built.vault({ portal: PORTAL, vaultInitCodeHash: VAULT_INIT_CODE_HASH });

    const expected = getCreate2Address({
      from: getAddress(PORTAL),
      salt: intentHash,
      bytecodeHash: VAULT_INIT_CODE_HASH,
    });
    expect(vault).toBe(expected);
  });

  it("gives a different vault for a different intentHash", () => {
    const a = openRoute("ethereum", "return 1n;", evmOptions()).reward(0n);
    const b = openRoute("ethereum", "return 2n;", evmOptions()).reward(0n);

    const vaultA = a.vault({ portal: PORTAL, vaultInitCodeHash: VAULT_INIT_CODE_HASH });
    const vaultB = b.vault({ portal: PORTAL, vaultInitCodeHash: VAULT_INIT_CODE_HASH });
    expect(vaultA).not.toBe(vaultB);
  });

  it("throws on a missing/short vaultInitCodeHash", () => {
    const intentHash = keccak256("0x01") as Hex;
    expect(() =>
      predictVaultAddress(intentHash, { portal: PORTAL, vaultInitCodeHash: "0x1234" as Hex }),
    ).toThrow();
    expect(() =>
      predictVaultAddress(intentHash, {
        portal: PORTAL,
        vaultInitCodeHash: undefined as unknown as Hex,
      }),
    ).toThrow();
  });
});

describe("openRoute: additive-ness — chainAccessors survives", () => {
  it("chainAccessors.Base is still callable and .chain resolves the registry record", () => {
    expect(typeof chainAccessors.Base).toBe("function");
    expect(chainAccessors.Base.chain.slug).toBe("base");
  });
});

describe("openRoute: reward argument shorthands", () => {
  it("a bare bigint means NATIVE amount only", () => {
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(123n);
    expect(built.intent.reward.nativeAmount).toBe(123n);
    expect(built.intent.reward.tokens).toHaveLength(0);
  });

  it("a bare TokenAmountInput[] means reward.tokens", () => {
    const tokens = [{ token: "0x7777777777777777777777777777777777777777" as const, amount: 5n }];
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(tokens);
    expect(built.intent.reward.tokens).toHaveLength(1);
    expect(built.intent.reward.tokens[0]!.amount).toBe(5n);
  });
});

describe("openRoute: fail-closed", () => {
  it("throws via requireChain for an unknown destination", () => {
    expect(() => openRoute("not-a-real-chain", "return 1n;", evmOptions())).toThrow();
  });

  it("throws for an svm destination missing a staged code account, pointing at the kitchen", () => {
    expect(() =>
      openRoute("solana", "return 1n;", {
        // deliberately missing `code` to exercise the fail-closed path
        execution: { accounts: [] } as never,
        deadline: 2000n,
        portal: PORTAL,
      }),
    ).toThrow(/execution\.code/i);
  });

  it("throws naming 'deadline' when IntentOptions.deadline is missing", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", { portal: PORTAL, pot: POT } as never),
    ).toThrow(/deadline/i);
  });

  // `portal` STOPPED being required: the SDK carries the eco-routes deployments, so a caller only
  // names a Portal to reach one the registry does not have.
  it("defaults the Portal to the eco-routes deployment for the destination", () => {
    const built = openRoute("ethereum", "return 1n;", {
      deadline: 2000n,
      pot: POT,
      engine: ENGINE,
    }).reward({ source: "base", creator: CREATOR, prover: PROVER, deadline: 2000n });

    expect(denormalizeToEvm(built.intent.route.portal).toLowerCase()).toBe(
      ecoRoutesPortal("ethereum").toLowerCase(),
    );
  });

  it("says which chain has no deployment rather than failing later", () => {
    // Zora is canonical but carries no eco-routes deployment in the pinned tables.
    expect(() =>
      openRoute("zora", "return 1n;", { deadline: 2000n, pot: POT, engine: ENGINE }),
    ).toThrow(/eco-routes v3 is not deployed on zora/i);
  });

  it("throws naming 'execution' when neither .execution nor .pot is supplied", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", { deadline: 2000n, portal: PORTAL } as never),
    ).toThrow(/execution/i);
  });

  it("throws naming 'source' when the reward has no source and options has none either", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", {
        pot: POT,
        engine: ENGINE,
        deadline: 2000n,
        portal: PORTAL,
      }).reward(0n),
    ).toThrow(/source/i);
  });

  it("throws naming 'creator' when the reward has no creator and options has none either", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", {
        pot: POT,
        engine: ENGINE,
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
      }).reward(0n),
    ).toThrow(/creator/i);
  });

  it("throws naming 'prover' when the reward has no prover and options has none either", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", {
        pot: POT,
        engine: ENGINE,
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: CREATOR,
      }).reward(0n),
    ).toThrow(/prover/i);
  });
});

// ---------------------------------------------------------------------------
// A2 — submission surface + sourcePortal + vaultCall/predictVault
// ---------------------------------------------------------------------------

const SOURCE_PORTAL = "0x8888888888888888888888888888888888888888" as const;
const OTHER_PORTAL = "0x9999999999999999999999999999999999999999" as const;

describe("BuiltIntent: sourcePortal defaulting", () => {
  // `sourcePortal` stopped being required along with `portal`: the SDK carries the eco-routes
  // deployments for the source chain too.
  it("defaults to the eco-routes Portal for the reward's source chain", () => {
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(0n);

    expect(built.publishCalldata().to.toLowerCase()).toBe(ecoRoutesPortal("base").toLowerCase());
    expect(built.vaultCall().to.toLowerCase()).toBe(ecoRoutesPortal("base").toLowerCase());
  });

  it("still says which chain has none, rather than failing later", () => {
    expect(() =>
      openRoute("ethereum", "return 1n;", evmOptions({ source: "zora" })).reward(0n),
    ).toThrow(/eco-routes v3 is not deployed on zora/i);
  });

  it("uses IntentOptions.sourcePortal when no per-call target is given", () => {
    const built = openRoute(
      "ethereum",
      "return 1n;",
      evmOptions({ sourcePortal: SOURCE_PORTAL }),
    ).reward(0n);
    expect(built.publishCalldata()).toEqual(publishTx(built.intent, { portal: SOURCE_PORTAL }));
    expect(built.vaultCall().to.toLowerCase()).toBe(SOURCE_PORTAL.toLowerCase());
  });

  it("a per-call target.portal overrides IntentOptions.sourcePortal", () => {
    const built = openRoute(
      "ethereum",
      "return 1n;",
      evmOptions({ sourcePortal: SOURCE_PORTAL }),
    ).reward(0n);
    const tx = built.publishCalldata({ portal: OTHER_PORTAL });
    expect(tx).toEqual(publishTx(built.intent, { portal: OTHER_PORTAL }));
    expect(tx.to.toLowerCase()).not.toBe(SOURCE_PORTAL.toLowerCase());
  });
});

describe("BuiltIntent: submission/read methods delegate to portal.ts", () => {
  const built = () =>
    openRoute("ethereum", "return 1n;", evmOptions({ sourcePortal: SOURCE_PORTAL })).reward(0n);

  it("publishCalldata === publishTx(intent, target)", () => {
    const b = built();
    expect(b.publishCalldata()).toEqual(publishTx(b.intent, { portal: SOURCE_PORTAL }));
  });

  it("publishAndFundCalldata === publishAndFundTx(intent, allowPartial, target)", () => {
    const b = built();
    expect(b.publishAndFundCalldata(true)).toEqual(
      publishAndFundTx(b.intent, true, { portal: SOURCE_PORTAL }),
    );
  });

  it("fundCalldata === fundTx(intent, allowPartial, target)", () => {
    const b = built();
    expect(b.fundCalldata(false)).toEqual(fundTx(b.intent, false, { portal: SOURCE_PORTAL }));
  });

  it("hashCall/fundedCall delegate to intentHashCall/isIntentFundedCall", () => {
    const b = built();
    const expectedHash = intentHashCall(b.intent, { portal: SOURCE_PORTAL });
    const expectedFunded = isIntentFundedCall(b.intent, { portal: SOURCE_PORTAL });
    expect(b.hashCall().to).toEqual(expectedHash.to);
    expect(b.hashCall().data).toEqual(expectedHash.data);
    expect(b.fundedCall().to).toEqual(expectedFunded.to);
    expect(b.fundedCall().data).toEqual(expectedFunded.data);
  });

  it("vaultCall === intentVaultAddressCall(intent, target), .to is the source Portal", () => {
    const b = built();
    const expected = intentVaultAddressCall(b.intent, { portal: SOURCE_PORTAL });
    expect(b.vaultCall().to).toEqual(expected.to);
    expect(b.vaultCall().data).toEqual(expected.data);
    expect(b.vaultCall().to.toLowerCase()).toBe(SOURCE_PORTAL.toLowerCase());
  });
});

describe("BuiltIntent: approvals() is head-only", () => {
  it("covers exactly the head's own reward tokens, matching approvalTxs(intent, target)", () => {
    const tokens = [{ token: "0x7777777777777777777777777777777777777777" as const, amount: 5n }];
    const built = openRoute(
      "ethereum",
      "return 1n;",
      evmOptions({ sourcePortal: SOURCE_PORTAL }),
    ).reward(tokens);
    expect(built.approvals()).toEqual(approvalTxs(built.intent, { portal: SOURCE_PORTAL }));
    expect(built.approvals()).toHaveLength(1);
  });
});

describe("BuiltIntent: vault(cfg) is a byte-identical alias of predictVault(cfg)", () => {
  it("returns the same address both ways", () => {
    const built = openRoute("ethereum", "return 1n;", evmOptions()).reward(0n);
    const cfg = { portal: PORTAL, vaultInitCodeHash: keccak256("0xdeadbeef") as Hex };
    expect(built.vault(cfg)).toBe(built.predictVault(cfg));
  });
});

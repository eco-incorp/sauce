/**
 * Cross-chain intent DSL — S1 contract tests.
 *
 * `intentOn(dest).route(spec).reward(spec)` compiles a Sauce route body for the destination chain
 * and slots it into a V2 `Intent`, reusing the EXISTING encode/hash/normalize machinery unchanged.
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
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { buildSauceSvmCall } from "../src/routes/sauce-calls.js";
import { compileSauceRoute, wrapSauceBody } from "../src/routes/sauce-route.js";
import { predictVaultAddress } from "../src/routes/vault.js";
import { intentOn, type SauceRewardSpec, type SauceRouteSpec } from "../src/routes/intent-dsl.js";
import type { RewardInput, RouteInput } from "../src/routes/types.js";
import { v12Pot } from "../src/evm/engine.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;

function evmRewardSpec(overrides: Partial<SauceRewardSpec> = {}): SauceRewardSpec {
  return {
    source: "base",
    deadline: 1000n,
    creator: CREATOR,
    prover: PROVER,
    ...overrides,
  };
}

describe("intentOn: EVM happy path", () => {
  it("compiles the route body and slots exactly one cook() call", () => {
    const built = intentOn("ethereum")
      .route({
        sauce: "function main() { return 1n; }",
        execution: { pot: POT },
        deadline: 2000n,
        portal: PORTAL,
      })
      .reward(evmRewardSpec());

    expect(built.intent.route.calls).toHaveLength(1);
    const call = built.intent.route.calls[0]!;
    expect(call.target).toBe(toUniversalAddress(POT));
    expect(call.value).toBe(0n);

    expect(built.compiled.bytecode.length).toBe(1);
    const expectedData = v12Pot.encodeCook([bytesToHex(built.compiled.bytecode[0]!)]);
    expect(call.data).toBe(expectedData);
  });
});

describe("intentOn: bare-body wrapping", () => {
  it("wraps a bare body into byte-identical bytecode as the explicit main() form", () => {
    const explicit = compileSauceRoute("ethereum", "function main() { let x = 1n; return x; }", {
      pot: POT,
    });
    const bare = compileSauceRoute("ethereum", "let x = 1n; return x;", { pot: POT });

    expect(bare.compiled.bytecode.length).toBe(explicit.compiled.bytecode.length);
    for (let i = 0; i < explicit.compiled.bytecode.length; i++) {
      expect(Array.from(bare.compiled.bytecode[i]!)).toEqual(Array.from(explicit.compiled.bytecode[i]!));
    }
  });

  it("wrapSauceBody leaves an already-complete program untouched", () => {
    const program = "function main() { return 1n; }";
    expect(wrapSauceBody(program)).toBe(program);
    expect(wrapSauceBody("return 1n;")).toBe("function main() {\nreturn 1n;\n}");
  });
});

describe("intentOn: precalls precede the compiled call", () => {
  it("keeps precalls first, in order, followed by the sauce call", () => {
    const precalls = [
      { target: "0x5555555555555555555555555555555555555555" as Hex, data: "0xaa" as Hex, value: 0n },
      { target: "0x6666666666666666666666666666666666666666" as Hex, data: "0xbb" as Hex, value: 0n },
    ];
    const built = intentOn("ethereum")
      .route({
        sauce: "return 1n;",
        execution: { pot: POT },
        deadline: 2000n,
        portal: PORTAL,
        precalls,
      })
      .reward(evmRewardSpec());

    expect(built.intent.route.calls).toHaveLength(3);
    expect(built.intent.route.calls[0]!.data).toBe("0xaa");
    expect(built.intent.route.calls[1]!.data).toBe("0xbb");
    // the compiled sauce call is last
    expect(built.intent.route.calls[2]!.target).toBe(toUniversalAddress(POT));
  });
});

describe("intentOn: assembled intent shape", () => {
  it("destination/sourceChainId are the two chain ids; route/reward equal direct normalize calls", () => {
    const routeSpec: SauceRouteSpec = {
      sauce: "return 1n;",
      execution: { pot: POT },
      deadline: 2000n,
      portal: PORTAL,
      tokens: [{ token: "0x7777777777777777777777777777777777777777", amount: 9n }],
      nativeAmount: 3n,
    };
    const rewardSpec = evmRewardSpec({ source: "base", nativeAmount: 4n });

    const built = intentOn("ethereum").route(routeSpec).reward(rewardSpec);

    expect(built.intent.destination).toBe(BigInt(requireChain("ethereum").id));
    expect(built.intent.sourceChainId).toBe(BigInt(requireChain("base").id));

    const expectedRoute: RouteInput = {
      deadline: routeSpec.deadline,
      portal: routeSpec.portal,
      nativeAmount: routeSpec.nativeAmount,
      tokens: routeSpec.tokens,
      calls: built.intent.route.calls,
    };
    expect(built.intent.route).toEqual(normalizeRoute(expectedRoute));

    const rewardInput: RewardInput = rewardSpec;
    expect(built.intent.reward).toEqual(normalizeReward(rewardInput));
  });
});

describe("intentOn: hash()", () => {
  it("agrees with hashIntent, and routeHash changes when the sauce source changes", () => {
    const buildWith = (sauce: string) =>
      intentOn("ethereum")
        .route({ sauce, execution: { pot: POT }, deadline: 2000n, portal: PORTAL })
        .reward(evmRewardSpec());

    const a = buildWith("return 1n;");
    const b = buildWith("return 2n;");

    expect(a.hash()).toEqual(hashIntent(a.intent));
    expect(b.hash()).toEqual(hashIntent(b.intent));
    expect(a.hash().routeHash).not.toBe(b.hash().routeHash);
    expect(a.hash().intentHash).not.toBe(b.hash().intentHash);
  });
});

describe("intentOn: encodeEVM()/encodeSVM()", () => {
  it("equal the direct encodeRouteEvm/Svm + encodeRewardEvm/Svm calls", () => {
    const built = intentOn("ethereum")
      .route({ sauce: "return 1n;", execution: { pot: POT }, deadline: 2000n, portal: PORTAL })
      .reward(evmRewardSpec());

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

describe("intentOn: SVM destination", () => {
  const BUFFER = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const ACCOUNT = address("So11111111111111111111111111111111111111112");

  it("compiles with target 'svm' and routes through buildSauceSvmCall", () => {
    const built = intentOn("solana")
      .route({
        sauce: "function main() { return 1n; }",
        execution: {
          buffer: BUFFER,
          accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
        },
        deadline: 2000n,
        portal: PORTAL,
      })
      .reward(evmRewardSpec());

    expect(built.intent.route.calls).toHaveLength(1);
    const call = built.intent.route.calls[0]!;
    expect(call.value).toBe(0n);

    const direct = buildSauceSvmCall({
      buffer: BUFFER,
      accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
    });
    expect(call).toEqual(direct);
  });

  it("rejects a nonzero value (SVM Call has no value field)", () => {
    expect(() =>
      intentOn("solana")
        .route({
          sauce: "return 1n;",
          execution: {
            buffer: BUFFER,
            accounts: [{ pubkey: ACCOUNT, isSigner: false, isWritable: false }],
            value: 1n,
          },
          deadline: 2000n,
          portal: PORTAL,
        })
        .reward(evmRewardSpec()),
    ).toThrow(/value/i);
  });
});

describe("vault(): predictVaultAddress", () => {
  const VAULT_INIT_CODE_HASH = keccak256("0xdeadbeef") as Hex;

  it("matches viem's getCreate2Address with an explicit bytecodeHash", () => {
    const built = intentOn("ethereum")
      .route({ sauce: "return 1n;", execution: { pot: POT }, deadline: 2000n, portal: PORTAL })
      .reward(evmRewardSpec());

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
    const a = intentOn("ethereum")
      .route({ sauce: "return 1n;", execution: { pot: POT }, deadline: 2000n, portal: PORTAL })
      .reward(evmRewardSpec());
    const b = intentOn("ethereum")
      .route({ sauce: "return 2n;", execution: { pot: POT }, deadline: 2000n, portal: PORTAL })
      .reward(evmRewardSpec());

    const vaultA = a.vault({ portal: PORTAL, vaultInitCodeHash: VAULT_INIT_CODE_HASH });
    const vaultB = b.vault({ portal: PORTAL, vaultInitCodeHash: VAULT_INIT_CODE_HASH });
    expect(vaultA).not.toBe(vaultB);
  });

  it("throws on a missing/short vaultInitCodeHash", () => {
    const intentHash = keccak256("0x01") as Hex;
    expect(() => predictVaultAddress(intentHash, { portal: PORTAL, vaultInitCodeHash: "0x1234" as Hex })).toThrow();
    expect(() =>
      predictVaultAddress(intentHash, { portal: PORTAL, vaultInitCodeHash: undefined as unknown as Hex }),
    ).toThrow();
  });
});

describe("intentOn: additive-ness — the existing builder + globals are untouched", () => {
  it("chainAccessors.Base.route(reward) still behaves as routes.test.ts asserts", () => {
    const reward: RewardInput = { deadline: 1000n, creator: CREATOR, prover: PROVER };
    const route: RouteInput = { deadline: 2000n, portal: PORTAL };
    const intents = chainAccessors.Base.route(reward).Solana(route).build();
    expect(intents).toHaveLength(1);
    expect(intents[0]!.sourceChainId).toBe(8453n);
    expect(intents[0]!.destination).toBe(1399811149n);
  });
});

describe("intentOn: fail-closed", () => {
  it("throws via requireChain for an unknown destination", () => {
    expect(() => intentOn("not-a-real-chain")).toThrow();
  });

  it("throws for an svm destination missing a staged buffer, pointing at sauce-calls.ts", () => {
    expect(() =>
      intentOn("solana").route({
        sauce: "return 1n;",
        // @ts-expect-error -- deliberately missing `buffer` to exercise the fail-closed path
        execution: { accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
      }),
    ).toThrow(/staging/i);
  });
});

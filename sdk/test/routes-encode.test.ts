/**
 * eco-routes on-chain encoding — E3.2. Pure encode/decode + hash assertions,
 * no compiler/forge/network involved.
 *
 * SVM parity note: the golden byte vector below was computed from this module's
 * own `@solana/kit` Borsh schema (which replicates the Portal IDL's declared
 * Route/Reward/TokenAmount/Call/Bytes32 layout) and is independently checkable
 * as correct standard Borsh. It was NOT produced by running a real
 * `@coral-xyz/anchor` `BorshCoder`. It pins the schema against regressions; it
 * does NOT prove the IDL matches the currently-deployed Portal program on any
 * cluster, nor that a hash computed this way is accepted on-chain. See
 * `src/routes/encode.ts`'s module doc comment for the full caveat.
 */
import { chainAccessors } from "../src/routes/accessors.js";
import { assembleIntent } from "../src/routes/intent.js";

const BASE_CHAIN_ID = 8453;
const SOLANA_CHAIN_ID = 1399811149;
import {
  decodeReward,
  decodeRoute,
  denormalizeToEvm,
  encodeIntent,
  encodeReward,
  encodeRewardEvm,
  encodeRewardSvm,
  encodeRoute,
  encodeRouteEvm,
  encodeRouteSvm,
  EVM_REWARD_PARAM,
  EVM_ROUTE_PARAM,
  hashIntent,
  kindOf,
  rewardHash,
  routeHash,
  svmCallCodec,
  svmRewardCodec,
  svmRouteCodec,
  svmTokenAmountCodec,
  toUniversalAddress,
} from "../src/routes/index.js";
import type { Call, Intent, Reward, Route, UniversalAddress } from "../src/routes/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const evmAddr = (byte: string): UniversalAddress => toUniversalAddress(("0x" + byte.repeat(20)) as `0x${string}`);
const svmAddr = (byte: string): UniversalAddress => toUniversalAddress(("0x" + byte.repeat(32)) as `0x${string}`);
const salt32 = (byte: string) => ("0x" + byte.repeat(32)) as `0x${string}`;

function baseRoute(overrides: Partial<Route> = {}): Route {
  return {
    salt: salt32("11"),
    deadline: 1893456000n,
    portal: evmAddr("22"),
    nativeAmount: 1000000n,
    tokens: [{ token: evmAddr("33"), amount: 250000n }],
    calls: [{ target: evmAddr("44"), data: "0xdeadbeef", value: 0n }],
    ...overrides,
  };
}

function baseReward(overrides: Partial<Reward> = {}): Reward {
  return {
    deadline: 1893456000n,
    creator: evmAddr("55"),
    prover: evmAddr("66"),
    nativeAmount: 7n,
    tokens: [{ token: evmAddr("77"), amount: 9n }],
    ...overrides,
  };
}

// ===========================================================================
// EVM
// ===========================================================================

describe("routes/encode: EVM round-trip", () => {
  it("round-trips an empty route (the terminal-leg shape)", () => {
    const route: Route = {
      salt: salt32("00"),
      deadline: 500n,
      portal: evmAddr("00"),
      nativeAmount: 0n,
      tokens: [],
      calls: [],
    };
    const decoded = decodeRoute(encodeRoute(route, "evm"), "evm");
    expect(decoded).toEqual(route);
  });

  it("round-trips a multi-token multi-call route", () => {
    const route = baseRoute({
      tokens: [
        { token: evmAddr("aa"), amount: 1n },
        { token: evmAddr("bb"), amount: 2n },
      ],
      calls: [
        { target: evmAddr("cc"), data: "0x", value: 0n },
        { target: evmAddr("dd"), data: "0x0102030405", value: 123n },
      ],
    });
    const decoded = decodeRoute(encodeRoute(route, "evm"), "evm");
    expect(decoded).toEqual(route);
  });

  it("round-trips long (>32B) calldata, exercising the dynamic tail", () => {
    const longData = ("0x" + "ab".repeat(100)) as `0x${string}`;
    const route = baseRoute({ calls: [{ target: evmAddr("44"), data: longData, value: 0n }] });
    const decoded = decodeRoute(encodeRoute(route, "evm"), "evm");
    expect(decoded).toEqual(route);
  });

  it("round-trips a near-uint256 amount", () => {
    const huge = 2n ** 256n - 1n;
    const route = baseRoute({ nativeAmount: huge, tokens: [{ token: evmAddr("33"), amount: huge }] });
    const decoded = decodeRoute(encodeRoute(route, "evm"), "evm");
    expect(decoded).toEqual(route);
  });

  it("round-trips a Reward", () => {
    const reward = baseReward();
    const decoded = decodeReward(encodeReward(reward, "evm"), "evm");
    expect(decoded).toEqual(reward);
  });
});

describe("routes/encode: EVM negatives", () => {
  it("throws denormalizing a UniversalAddress with a nonzero high half (a real SVM pubkey)", () => {
    const pubkey = svmAddr("ff");
    expect(() => denormalizeToEvm(pubkey)).toThrow(/not EVM-representable/);
  });

  it("throws encoding a route whose portal is a 32-byte pubkey for an EVM chain", () => {
    const route = baseRoute({ portal: svmAddr("ff") });
    expect(() => encodeRoute(route, "evm")).toThrow();
  });

  it("throws on a non-32-byte salt", () => {
    const route = baseRoute({ salt: "0x1234" as `0x${string}` });
    expect(() => encodeRouteEvm(route)).toThrow(/salt/i);
  });
});

describe("routes/encode: EVM pinned known vector", () => {
  // Cross-checked, not transcribed: this component order/types was reproduced
  // by parsing `fulfillAndProve.inputs[1]` / `publish.inputs[2]` out of the
  // real Portal ABI text and re-hashing the same fixture through the
  // parsed-from-source param — identical hashes both ways.
  const route = baseRoute();
  const reward = baseReward();
  const destination = 8453n;

  it("pins routeHash / rewardHash / hashIntent to the known vector", () => {
    expect(routeHash(route, destination)).toBe(
      "0xd4a4c0bd2d3116db3b3bd07982a9dd0910e0a10c2c991e218e7150976c2ff7b2",
    );
    expect(rewardHash(reward, destination)).toBe(
      "0xaf0765f75a2c5534477dce55a4eb1f5dd3f5bcb4d988567f53e125fac06b2973",
    );

    const intent: Intent = { destination, sourceChainId: destination, route, reward };
    const hashes = hashIntent(intent);
    expect(hashes.routeHash).toBe(routeHash(route, destination));
    expect(hashes.rewardHash).toBe(rewardHash(reward, destination));
    expect(hashes.intentHash).toBe(
      "0x296c8a84b1442da8367e2f1d564a8c83b45fe551da19d2f8cbf37116bb9c566b",
    );
  });

  it("EVM_ROUTE_PARAM / EVM_REWARD_PARAM are the exported literals actually used", () => {
    expect(EVM_ROUTE_PARAM.components.map((c) => c.name)).toEqual([
      "salt",
      "deadline",
      "portal",
      "nativeAmount",
      "tokens",
      "calls",
    ]);
    expect(EVM_REWARD_PARAM.components.map((c) => c.name)).toEqual([
      "deadline",
      "creator",
      "prover",
      "nativeAmount",
      "tokens",
    ]);
  });
});

// ===========================================================================
// SVM
// ===========================================================================

function svmRoute(overrides: Partial<Route> = {}): Route {
  return {
    salt: salt32("11"),
    deadline: 1893456000n,
    portal: svmAddr("22"),
    nativeAmount: 1000000n,
    tokens: [{ token: svmAddr("33"), amount: 250000n }],
    calls: [{ target: svmAddr("44"), data: "0xdeadbeef", value: 0n }],
    ...overrides,
  };
}

function svmReward(overrides: Partial<Reward> = {}): Reward {
  return {
    deadline: 1893456000n,
    creator: svmAddr("55"),
    prover: svmAddr("66"),
    nativeAmount: 7n,
    tokens: [{ token: svmAddr("77"), amount: 9n }],
    ...overrides,
  };
}

describe("routes/encode: SVM round-trip", () => {
  it("round-trips a Route through our own @solana/kit codec, value reconstituted as 0n", () => {
    const route = svmRoute();
    const decoded = decodeRoute(encodeRoute(route, "svm"), "svm");
    expect(decoded).toEqual(route);
  });

  it("round-trips a Reward through our own @solana/kit codec", () => {
    const reward = svmReward();
    const decoded = decodeReward(encodeReward(reward, "svm"), "svm");
    expect(decoded).toEqual(reward);
  });

  it("round-trips an empty-tokens/calls Route", () => {
    const route = svmRoute({ tokens: [], calls: [] });
    const decoded = decodeRoute(encodeRoute(route, "svm"), "svm");
    expect(decoded).toEqual(route);
  });
});

describe("routes/encode: SVM golden byte vector (standard-Borsh schema regression pin)", () => {
  // Pinned standard-Borsh bytes for the fixture below, computed from this
  // module's own @solana/kit schema (which replicates the Portal IDL layout)
  // and independently checkable as correct Borsh — a regression pin, not an
  // Anchor cross-run (see the file header caveat).
  it("matches the pinned standard-Borsh golden vector for a representative Route", () => {
    const route = svmRoute();
    const encoded = encodeRouteSvm(route);
    expect(encoded).toBe(
      "0x" +
        "1111111111111111111111111111111111111111111111111111111111111111" +
        "80d8db7000000000" +
        "2222222222222222222222222222222222222222222222222222222222222222" +
        "40420f0000000000" +
        "01000000" +
        "3333333333333333333333333333333333333333333333333333333333333333" +
        "90d0030000000000" +
        "01000000" +
        "4444444444444444444444444444444444444444444444444444444444444444" +
        "04000000" +
        "deadbeef",
    );
  });

  it("matches the pinned standard-Borsh golden vector for a representative Reward", () => {
    const reward = svmReward();
    const encoded = encodeRewardSvm(reward);
    expect(encoded).toBe(
      "0x" +
        "80d8db7000000000" +
        "5555555555555555555555555555555555555555555555555555555555555555" +
        "6666666666666666666666666666666666666666666666666666666666666666" +
        "0700000000000000" +
        "01000000" +
        "7777777777777777777777777777777777777777777777777777777777777777" +
        "0900000000000000",
    );
  });

  it("exports the codecs used to produce the golden vector", () => {
    expect(svmRouteCodec).toBeDefined();
    expect(svmRewardCodec).toBeDefined();
    expect(svmTokenAmountCodec).toBeDefined();
    expect(svmCallCodec).toBeDefined();
  });
});

describe("routes/encode: SVM negatives", () => {
  it("throws encoding a Call with a nonzero value (SVM Call has no value field)", () => {
    const call: Call = { target: svmAddr("44"), data: "0xdead", value: 1n };
    const route = svmRoute({ calls: [call] });
    expect(() => encodeRouteSvm(route)).toThrow(/no value field/);
  });

  it("throws when an amount does not fit in a u64 (an 18-decimal token above ~18.44 units)", () => {
    const tooLarge = 2n ** 64n; // exactly out of u64 range
    const route = svmRoute({ tokens: [{ token: svmAddr("33"), amount: tooLarge }] });
    expect(() => encodeRouteSvm(route)).toThrow(/u64/);
  });

  it("throws when nativeAmount does not fit in a u64", () => {
    const route = svmRoute({ nativeAmount: 2n ** 64n });
    expect(() => encodeRouteSvm(route)).toThrow(/u64/);
  });

  it("throws when deadline does not fit in a u64", () => {
    const reward = svmReward({ deadline: 2n ** 64n });
    expect(() => encodeRewardSvm(reward)).toThrow(/u64/);
  });
});

// ===========================================================================
// Fork + hash wiring
// ===========================================================================

describe("routes/encode: fork by chain kind", () => {
  it("kindOf resolves via the canonical registry and accepts a literal escape hatch", () => {
    expect(kindOf(BASE_CHAIN_ID)).toBe("evm");
    expect(kindOf(SOLANA_CHAIN_ID)).toBe("svm");
    expect(kindOf("evm")).toBe("evm");
    expect(kindOf("svm")).toBe("svm");
  });

  it("throws on an unregistered chain id rather than defaulting to EVM", () => {
    expect(() => kindOf(1399811150)).toThrow(); // Solana devnet -- not registered
    expect(() => kindOf(728126428)).toThrow(); // Tron -- not registered
    // the escape hatch still works for the same unregistered id:
    expect(kindOf("svm")).toBe("svm");
  });

  it("the same Route encodes to different bytes for an EVM vs an SVM destination", () => {
    const route = baseRoute();
    // baseRoute's addresses are 20-byte-derived UniversalAddresses, valid for EVM;
    // encoding for SVM instead just treats them as already-32-byte pubkeys.
    const evmBytes = encodeRoute(route, "evm");
    const svmBytes = encodeRoute(route, "svm");
    expect(evmBytes).not.toBe(svmBytes);
  });

  it("hashIntent uses the SVM encoding for the route and EVM encoding for the reward on a Base->Solana intent", () => {
    const route = svmRoute();
    const reward = baseReward();
    const intent: Intent = { destination: BigInt(SOLANA_CHAIN_ID), sourceChainId: BigInt(BASE_CHAIN_ID), route, reward };

    const hashes = hashIntent(intent);
    expect(hashes.routeHash).toBe(routeHash(route, "svm"));
    expect(hashes.rewardHash).toBe(rewardHash(reward, "evm"));

    const { route: encodedRoute, reward: encodedReward } = encodeIntent(intent);
    expect(encodedRoute).toBe(encodeRouteSvm(route));
    expect(encodedReward).toBe(encodeRewardEvm(reward));
  });
});

describe("routes/encode: end-to-end over multiple assembled intents", () => {
  it("hashes every leg of Base -> Solana -> Ethereum deterministically", () => {
    const { Base: BaseAcc, Solana: SolanaAcc, Ethereum: EthereumAcc } = chainAccessors;

    const r1 = {
      deadline: 111n,
      creator: "0x1111111111111111111111111111111111111111" as const,
      prover: "0x2222222222222222222222222222222222222222" as const,
    };
    const route2 = {
      deadline: 222n,
      portal: ("0x" + "33".repeat(32)) as `0x${string}`,
      calls: [{ target: ("0x" + "44".repeat(32)) as `0x${string}`, data: "0xaa" as const, value: 0n }],
    };
    const r3 = {
      deadline: 333n,
      creator: "0x5555555555555555555555555555555555555555" as const,
      prover: "0x6666666666666666666666666666666666666666" as const,
    };

    const leg1 = assembleIntent(BaseAcc.chain, SolanaAcc.chain, route2, r1);
    const leg2 = assembleIntent(SolanaAcc.chain, EthereumAcc.chain, undefined, r3);
    const intents = [leg1, leg2];
    expect(intents.length).toBeGreaterThanOrEqual(2);

    for (const intent of intents) {
      const hashes = hashIntent(intent);
      expect(hashes.intentHash).toMatch(/^0x[0-9a-f]{64}$/);
      // deterministic: recomputing yields the same hash
      expect(hashIntent(intent).intentHash).toBe(hashes.intentHash);
    }

    // the terminal leg (Ethereum() close) still hashes a valid, deterministic
    // (if not submittable) empty-route shape.
    const terminal = intents[intents.length - 1]!;
    expect(terminal.route.tokens).toEqual([]);
    expect(terminal.route.calls).toEqual([]);
    expect(hashIntent(terminal).intentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

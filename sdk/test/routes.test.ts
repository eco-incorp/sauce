/**
 * eco-routes chain-global surface — CONTRACT tests. Pure data assertions, no
 * compiler/forge/network involved beyond the trivial one-op SauceScript
 * programs compiled below.
 */
import { canonicalChains, requireChain } from "../src/chains/canonical.js";
import { chain, chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import type { PendingSauceRoute } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;

function baseOptions(overrides: Record<string, unknown> = {}) {
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

describe("routes: callable alias === .route", () => {
  it("Base(sauce, opts) and Base.route(sauce, opts) produce deep-equal Intents", () => {
    const { Base } = chainAccessors;
    const viaCall = Base("return 1n;", baseOptions()).reward(0n);
    const viaRoute = Base.route("return 1n;", baseOptions()).reward(0n);
    expect(viaCall.intent).toEqual(viaRoute.intent);
  });

  it("typeof chainAccessors.Base === 'function' and its own keys are exactly ['chain','route']", () => {
    expect(typeof chainAccessors.Base).toBe("function");
    expect(Object.keys(chainAccessors.Base).sort()).toEqual(["chain", "route"]);
  });

  it("chain('eth')/chain(8453)/chain('BNB Chain') resolve and are callable", () => {
    expect(typeof chain("eth")).toBe("function");
    expect(chain("eth").chain.slug).toBe("ethereum");
    expect(chain(8453).chain.slug).toBe("base");
    expect(chain("BNB Chain").chain.slug).toBe("bsc");
  });

  it("chain('bogus') throws Unknown chain", () => {
    expect(() => chain("bogus")).toThrow(/Unknown chain 'bogus'/);
  });
});

describe("routes: accessor generation is registry-derived", () => {
  it("the key set matches a fresh pascal derivation from canonicalChains, no literal list", () => {
    const expectedKeys = canonicalChains.map((c) => pascalOfSlug(c.slug)).sort();
    const actualKeys = Object.keys(chainAccessors).sort();
    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(expectedKeys).size).toBe(expectedKeys.length); // duplicate-free
    expect(Object.keys(chainAccessors)).toHaveLength(canonicalChains.length);
  });

  it("each global's .chain is the matching registry record", () => {
    for (const c of canonicalChains) {
      const key = pascalOfSlug(c.slug);
      expect((chainAccessors as Record<string, { chain: unknown }>)[key]!.chain).toEqual(c);
    }
  });
});

describe("routes: EVM happy path", () => {
  it("compiles the route body and slots exactly one cook() call into a well-formed Intent", () => {
    const { Ethereum } = chainAccessors;
    const built = Ethereum("function main() { return 1n; }", {
      pot: POT,
      engine: ENGINE,
      deadline: 2000n,
      portal: PORTAL,
    }).reward({ source: "base", deadline: 1000n, creator: CREATOR, prover: PROVER });

    expect(built.intent.route.calls).toHaveLength(1);
    expect(built.intent.destination).toBe(BigInt(requireChain("ethereum").id));
    expect(built.intent.sourceChainId).toBe(BigInt(requireChain("base").id));
    expect(built.compiled.bytecode.length).toBe(1);
  });
});

describe("routes: stage immutability / branching", () => {
  it("one PendingSauceRoute reused for two .reward() calls yields independent Intents", () => {
    const { Ethereum } = chainAccessors;
    const pending: PendingSauceRoute = Ethereum("return 1n;", baseOptions());
    const a = pending.reward(0n);
    const b = pending.reward(5n);
    expect(a.intent.reward.nativeAmount).toBe(0n);
    expect(b.intent.reward.nativeAmount).toBe(5n);
  });

  it("intents() returns a fresh array each call", () => {
    const { Ethereum } = chainAccessors;
    const built = Ethereum("return 1n;", baseOptions()).reward(0n);
    const a = built.intents();
    const b = built.intents();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("routes: string-body form (stage-1 compatibility) on an SVM destination", () => {
  it("Solana.route(sauceString, {execution:{buffer,...}}) still works", () => {
    const { Solana } = chainAccessors;
    const built = Solana.route("function main() { return 1n; }", {
      execution: {
        code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        accounts: [
          {
            pubkey: "So11111111111111111111111111111111111111112",
            isSigner: false,
            isWritable: false,
          },
        ],
      },
      deadline: 2000n,
      portal: PORTAL,
    }).reward({ source: "base", deadline: 1000n, creator: CREATOR, prover: PROVER });

    expect(built.intent.route.calls).toHaveLength(1);
    expect(built.intent.destination).toBe(BigInt(requireChain("solana").id));
  });
});

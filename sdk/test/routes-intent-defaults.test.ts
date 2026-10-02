/**
 * What `Base(body, options).reward(reward)` resolves on its own, so a caller passes only what is
 * theirs: the deadlines, the creator, the amounts.
 *
 *  - The PROVER defaults to the one the eco-routes registry records for the source/destination
 *    pair (`ecoRoutesProver`) — the same function `Chain(() => …).reward(…)` in a program and
 *    `sauce intent publish` default through, so the three record one prover for one pair.
 *  - The route's NATIVE AMOUNT defaults to what its calls spend: every call's value, each cook's
 *    `execution.value` among them, less a `fundedByBody` child's native reward.
 *  - The Portals were already defaulted; they are checked here beside the rest.
 *
 * And an explicit value still wins, byte for byte: a caller who passes the values gets exactly
 * the intent they got before these defaults existed.
 */
import { address } from "@solana/kit";
import type { Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import {
  ecoRoutesContract,
  ecoRoutesPortal,
  ecoRoutesProver,
  type EcoRoutesSelector,
} from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { toUniversalAddress } from "../src/routes/normalize.js";

const BODY = "function main() { return 1n; }";
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const OTHER_PROVER = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x7777777777777777777777777777777777777777" as const;
const FEE = 1_000n;

const STAGING: EcoRoutesSelector = { environment: "staging" };

const universal = (value: Hex) => toUniversalAddress(value);
const hyperProver = (chain: string, selector?: EcoRoutesSelector) =>
  universal(ecoRoutesContract(chain, "HyperProver", selector));

/** The options the README passes now: a deadline and the cook's fee, nothing the SDK knows. */
const minimal = (overrides: Partial<IntentOptions> = {}): IntentOptions => ({
  execution: { value: FEE },
  deadline: 2_000_000_000n,
  ...overrides,
});
const reward = { source: "ethereum", creator: CREATOR, deadline: 2_000_003_600n } as const;

describe("the reward's prover defaults to the registry's for the pair", () => {
  it.each([
    ["ethereum", "base"],
    ["base", "ethereum"],
    ["ethereum", "arbitrum"],
    ["base", "optimism"],
  ])("a reward on %s for %s records the source's HyperProver", (source, destination) => {
    const built = openRoute(destination, BODY, minimal()).reward({ ...reward, source });

    expect(built.intent.reward.prover).toBe(hyperProver(source));
  });

  it("follows the eco-routes selector, as the Portal does", () => {
    const built = openRoute("base", BODY, minimal({ ecoRoutes: STAGING })).reward(reward);

    expect(built.intent.reward.prover).toBe(hyperProver("ethereum", STAGING));
    expect(built.intent.reward.prover).not.toBe(hyperProver("ethereum"));
    expect(denormalizeToEvm(built.intent.route.portal)).toBe(
      ecoRoutesPortal("base", STAGING).toLowerCase(),
    );
  });

  it("is a Solana source's own HyperProver program, and an EVM one for a Solana destination", () => {
    // From Solana: the reward is escrowed by Solana's Portal, so its prover is Solana's program.
    const fromSolana = openRoute("base", BODY, minimal()).reward({
      ...reward,
      source: "solana",
      creator: `0x${"33".repeat(32)}`,
    });
    expect(fromSolana.intent.reward.prover).toBe(hyperProver("solana"));
    expect(fromSolana.intent.reward.prover).not.toMatch(/^0x0{24}/);

    // To Solana: the reward is on Ethereum, so Ethereum's HyperProver, which Solana's dispatches to.
    const toSolana = openRoute("solana", BODY, {
      deadline: 2_000_000_000n,
      execution: {
        code: address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        accounts: [],
      },
    }).reward(reward);
    expect(toSolana.intent.reward.prover).toBe(hyperProver("ethereum"));
  });

  it("is what an intent opened inside a program records, through the same lookup", () => {
    // `sauce-route.ts` hands the in-program lowering `ecoRoutesProver` as its `proverFor`, which is
    // also what `sauce intent publish` compiles through. Staging's provers differ from production's,
    // so the child's publication, carried in the parent's cook, shows which deployment it used.
    const parent = openRoute(
      "base",
      `function main() {
  Arbitrum(() => { USDC.transfer(RECIPIENT, 1n); }).reward({ tokens: [{ token: USDC, amount: 1n }] });
}`,
      minimal({ creator: CREATOR, defines: { RECIPIENT: BigInt(CREATOR) }, ecoRoutes: STAGING }),
    ).reward(reward);
    const cook = parent.intent.route.calls[0]!.data.toLowerCase();
    const word = (prover: Hex) => universal(prover).slice(2);

    expect(parent.intent.reward.prover).toBe(
      universal(ecoRoutesProver("ethereum", "base", STAGING)),
    );
    expect(cook).toContain(word(ecoRoutesProver("base", "arbitrum", STAGING)));
    expect(cook).not.toContain(word(ecoRoutesProver("base", "arbitrum")));
  });

  it("is overridden by IntentOptions.prover, and that by reward.prover", () => {
    const fromOptions = openRoute("base", BODY, minimal({ prover: OTHER_PROVER })).reward(reward);
    expect(fromOptions.intent.reward.prover).toBe(universal(OTHER_PROVER));

    const fromReward = openRoute("base", BODY, minimal({ prover: TOKEN })).reward({
      ...reward,
      prover: OTHER_PROVER,
    });
    expect(fromReward.intent.reward.prover).toBe(universal(OTHER_PROVER));
  });

  it("is required, naming the chains, where the registry records no prover for the pair", () => {
    // Ronin has a Portal and no prover; Zora has no eco-routes deployment at all.
    expect(() => openRoute("base", BODY, minimal()).reward({ ...reward, source: "ronin" })).toThrow(
      /'prover' is required for a reward on ronin for base — .*no prover deployed on both ronin and base.*`reward\.prover`/,
    );
    expect(() => openRoute("base", BODY, minimal()).reward({ ...reward, source: "zora" })).toThrow(
      /'prover' is required for a reward on zora for base — .*not deployed on zora/,
    );
    // An explicit prover is all such a pair needs from the reward; the Portal is the caller's too.
    expect(() =>
      openRoute("base", BODY, minimal({ sourcePortal: TOKEN })).reward({
        ...reward,
        source: "zora",
        prover: OTHER_PROVER,
      }),
    ).not.toThrow();
  });
});

describe("the route's nativeAmount defaults to what its calls spend", () => {
  it("is the cook's execution value: the Kitchen fee", () => {
    const built = openRoute("base", BODY, minimal()).reward(reward);

    expect(built.intent.route.calls.map((call) => call.value)).toEqual([FEE]);
    expect(built.intent.route.nativeAmount).toBe(FEE);
  });

  it("is zero for a cook that sends nothing", () => {
    const built = openRoute("base", BODY, { deadline: 2_000_000_000n }).reward(reward);

    expect(built.intent.route.nativeAmount).toBe(0n);
  });

  it("adds every precall's value", () => {
    const built = openRoute(
      "base",
      BODY,
      minimal({ precalls: [{ target: TOKEN, data: "0x", value: 5n }] }),
    ).reward(reward);

    expect(built.intent.route.nativeAmount).toBe(FEE + 5n);
  });

  describe("with nested children", () => {
    const child = (nativeAmount: bigint) => (on: ReturnType<typeof requireChain>) =>
      openRoute("arbitrum", BODY, { deadline: 2_000_000_000n }).reward({
        source: on,
        creator: CREATOR,
        deadline: 2_000_003_600n,
        nativeAmount,
      });

    it("adds a publishAndFund child's native reward, which the Executor forwards", () => {
      const built = openRoute("base", BODY, minimal())
        .nest(child(50n), { via: "publishAndFund" })
        .reward(reward);

      expect(built.intent.route.nativeAmount).toBe(FEE + 50n);
    });

    it("leaves out a fundedByBody child's, which the program forwards itself", () => {
      const built = openRoute("base", BODY, minimal())
        .nest(child(50n), { via: "publishAndFund", fundedByBody: true })
        .reward(reward);

      expect(built.intent.route.nativeAmount).toBe(FEE);
    });

    it("adds a transfer child's cook: its fee and the native it forwards from the route", () => {
      const built = openRoute("base", BODY, minimal())
        .nest(child(50n), { executionFee: 7n, fundNativeFromRoute: true })
        .reward(reward);

      expect(built.intent.route.calls.map((call) => call.value)).toEqual([FEE, 57n]);
      expect(built.intent.route.nativeAmount).toBe(FEE + 57n);
    });
  });
});

describe("a caller who passes the values gets the intent they got before", () => {
  it("passing the defaults explicitly builds the same intent", () => {
    const defaulted = openRoute("base", BODY, minimal()).reward(reward);
    const explicit = openRoute(
      "base",
      BODY,
      minimal({
        portal: ecoRoutesPortal("base"),
        sourcePortal: ecoRoutesPortal("ethereum"),
        nativeAmount: FEE,
      }),
    ).reward({ ...reward, prover: ecoRoutesContract("ethereum", "HyperProver"), nativeAmount: 0n });

    expect(explicit.intent).toEqual(defaulted.intent);
    expect(explicit.hash()).toEqual(defaulted.hash());
    expect(explicit.sourceTxs()).toEqual(defaulted.sourceTxs());
  });

  it("an explicit nativeAmount is kept as given, even one that differs from the calls'", () => {
    for (const nativeAmount of [0n, FEE + 1n, 5_000n]) {
      const built = openRoute("base", BODY, minimal({ nativeAmount })).reward(reward);
      expect(built.intent.route.nativeAmount).toBe(nativeAmount);
    }
  });

  it("an explicit nativeAmount below a nested cook's fee is still refused", () => {
    expect(() =>
      openRoute("base", BODY, minimal({ nativeAmount: FEE }))
        .nest(
          (on) =>
            openRoute("arbitrum", BODY, { deadline: 2_000_000_000n }).reward({
              source: on,
              creator: CREATOR,
              deadline: 2_000_003_600n,
              tokens: [{ token: TOKEN, amount: 1n }],
            }),
          { executionFee: 7n },
        )
        .reward(reward),
    ).toThrow(/route\.nativeAmount must cover 1007 wei/);
  });

  it("the reward's native amount defaults to zero", () => {
    const built = openRoute("base", BODY, minimal()).reward(reward);

    expect(built.intent.reward.nativeAmount).toBe(0n);
  });
});

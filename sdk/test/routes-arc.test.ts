/**
 * Arc (5042) end to end through the public surface: the named `Arc` export and a typed closure on
 * it, Arc's chain-scoped defines, and intents in both directions between Base and Arc.
 *
 * Arc has the Portal every other chain has, so an intent to Arc records it and cooks on the shared
 * Pot its Executor owns; an intent from Arc publishes and funds on it, with native value in USDC at
 * 18 decimals. Arc's Portal aliases that native coin to the USDC ERC-20, so a reward offers native
 * value or the USDC token, never both: one with a native amount and a USDC leg reverts
 * `RewardTokensNotUnique(USDC)` at publish (read with an `eth_call` on Arc). Offline: every address
 * below was read from the chain or comes from the registries; Pot predictions use Kitchen 1.1.0
 * release initcode (see deployments-pot.test.ts), pending deployment.
 */
import { bytesToHex, decodeFunctionData, getAddress, type Hex } from "viem";

import { Arc, Base, destinationPot, requireChain, routes } from "../src/index.js";
import { chainDefines } from "../src/routes/ambient.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { v12Pot } from "../src/evm/engine.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";

const PORTAL = "0xEC000769A73b70e16f361a442292500b3BCf4A85";
const SHARED_POT = "0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_SWAP_ROUTER02 = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CREATOR = "0x6666666666666666666666666666666666666666";
/** Arc's Kitchen.executionFee() on 2026-09-28: 0.01 USDC in 18-decimal native units. */
const ARC_EXECUTION_FEE = 10n ** 16n;
const ENGINE = v12EngineAddress() as Hex;

const evm = (word: string): Hex => getAddress(denormalizeToEvm(word as Hex)) as Hex;
const decimal = (address: string): string => `${BigInt(address)}n`;

describe("Arc: the named export", () => {
  it("is the canonical Arc chain", () => {
    expect(Arc.chain).toBe(requireChain("arc"));
    expect(Arc.chain.id).toBe(5042);
    expect(requireChain("arc-mainnet")).toBe(Arc.chain);
  });
});

describe("Arc: chain-scoped defines", () => {
  it("carries Arc's chain id, tokens and registry contracts", () => {
    const defines = chainDefines(requireChain("arc"));
    expect(defines.chainId).toBe(5042n);
    expect(defines.USDC).toBe(BigInt(ARC_USDC));
    expect(defines.WETH).toBe(BigInt("0x128cC466B61f542da60c70e3aA11c10e19B84EDB"));
    expect(defines.UniswapV3_SwapRouter02).toBe(BigInt(ARC_SWAP_ROUTER02));
    expect(defines.Cctp_TokenMessenger).toBe(BigInt("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"));
  });

  it("compiles a route on Arc that names USDC and a registry protocol", () => {
    const compiled = routes.compileSauceRoute(
      "arc",
      "USDC.approve(UniswapV3.SwapRouter02, 1_000_000n);",
      { pot: SHARED_POT, engine: ENGINE, value: ARC_EXECUTION_FEE },
      { defines: chainDefines(requireChain("arc")) },
    );
    // The write is `@sauce/token`'s, on Arc's USDC, to Arc's SwapRouter02: the program the same
    // call written by hand compiles to.
    const written = routes.compileSauceRoute(
      "arc",
      `import { approve } from "@sauce/token";\napprove(${decimal(ARC_USDC)}, ${decimal(ARC_SWAP_ROUTER02)}, 1_000_000n);`,
      { pot: SHARED_POT, engine: ENGINE, value: ARC_EXECUTION_FEE },
    );
    expect(compiled.compiled.bytecode[0]).toEqual(written.compiled.bytecode[0]);
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(compiled.calls).toHaveLength(1);
    expect(evm(compiled.calls[0]!.target)).toBe(SHARED_POT);
    // The Kitchen fee rides as native value, unscaled: on Arc that is 18-decimal USDC.
    expect(compiled.calls[0]!.value).toBe(ARC_EXECUTION_FEE);
  });

  it("the same body resolves Base's contracts on Base", () => {
    const onBase = routes.compileSauceRoute(
      "base",
      "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);",
      { pot: SHARED_POT, engine: ENGINE },
    );
    const onArc = routes.compileSauceRoute(
      "arc",
      "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);",
      { pot: SHARED_POT, engine: ENGINE },
    );
    const carries = (compiled: typeof onArc, address: string) =>
      Buffer.from(compiled.compiled.bytecode[0]!)
        .toString("hex")
        .includes(address.slice(2).toLowerCase());
    expect(carries(onArc, "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1")).toBe(true);
    expect(carries(onBase, "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1")).toBe(false);
  });
});

describe("Arc: intents", () => {
  const amount = 1_000_000n;
  const carries = (bytes: Uint8Array, word: string) =>
    Buffer.from(bytes).toString("hex").includes(word.slice(2).toLowerCase());

  it("Base -> Arc: the body compiles for Arc and cooks on the shared Pot through its Portal", () => {
    const intent = Arc.hop({
      source: Base,
      reward: { token: BASE_USDC, amount },
      receive: { token: ARC_USDC, amount },
      refundee: CREATOR,
      prover: ecoRoutesProver("base", "arc"),
      fee: ARC_EXECUTION_FEE,
    }).then(() => {
      USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);
    });

    expect(intent.program.chain).toBe(requireChain("base"));
    const [body] = intent.program.bodies;
    expect(body!.destination).toBe(requireChain("arc"));
    expect(ecoRoutesPortal("arc")).toBe(PORTAL);
    expect(destinationPot("arc")).toBe(SHARED_POT);
    expect(destinationPot("base")).toBe(SHARED_POT);
    // The program publishes on Base's Portal an intent whose route names Arc's Portal and cooks on
    // the shared Pot: both are one address, carried in the program.
    expect(carries(intent.program.bytecode, PORTAL)).toBe(true);
    expect(carries(intent.program.bytecode, SHARED_POT)).toBe(true);
    // Its cook runs on the owner's Pot, with the source Kitchen's fee.
    const cook = intent.cook({ owner: CREATOR }, 7n);
    expect(cook.value).toBe(7n);
    const decoded = decodeFunctionData({ abi: v12Pot.abi, data: cook.data });
    expect(decoded.args?.[0]).toBe(v12EngineAddress());
    expect(decoded.args?.[1]).toBe(bytesToHex(intent.program.bytecode));
  });

  it("Arc -> Base: a native reward, or Arc's USDC as a token, opens from Arc", () => {
    const open = (reward: routes.HopReward) =>
      Base.hop({ source: Arc, reward, refundee: CREATOR, fee: 1n }).then(() => {});
    expect(open({ native: 10n ** 18n }).program.chain).toBe(requireChain("arc"));
    expect(open({ token: ARC_USDC, amount }).program.chain).toBe(requireChain("arc"));
  });

  it("both directions share the prover eco-routes deploys on both ends", () => {
    expect(ecoRoutesProver("base", "arc")).toBe(ecoRoutesProver("arc", "base"));
  });
});

describe("Arc: a reward cannot offer native value and USDC together", () => {
  const amount = 1_000_000n;
  const oneUsdcNative = 10n ** 18n;
  const REFUSAL =
    /arc \(chain 5042\) offers both a nativeAmount and a USDC token leg \(0x3600000000000000000000000000000000000000\)[\s\S]*RewardTokensNotUnique[\s\S]*Fold them into one leg/;
  /** Both: native value and `token`, from `source` to `destination`. */
  const both = (
    source: routes.HopChain,
    destination: { readonly hop: routes.ChainHop },
    token: Hex,
  ) =>
    destination
      .hop({
        source,
        reward: [{ native: oneUsdcNative }, { token, amount }],
        refundee: CREATOR,
        fee: 1n,
      })
      .then(() => {});
  /** A program that opens an intent to `destination`, rewarded in native value AND its own chain's
   *  USDC. */
  const program = (destination: string) => `
    function main() {
      const amount = USDC.balanceOf(ctx.self());
      ${destination}.hop({ reward: [{ token: USDC, amount }, { native: 1n }], refundee: 0x3333333333333333333333333333333333333333 }).then(() => {
        USDC.transfer(RECIPIENT, amount);
      });
    }
  `;
  const compileOn = (chain: string, destination: string) =>
    routes.compileSauceRoute(
      chain,
      program(destination),
      { pot: SHARED_POT, engine: ENGINE },
      {
        ambient: ["@sauce/token"],
        defines: { RECIPIENT: 0x2222222222222222222222222222222222222222n },
        intents: { deadline: 2_000_000_000n, executionFee: 1n },
      },
    );

  it("the TypeScript builder refuses it when it compiles, naming the chain, the token and the remedy", () => {
    expect(() => both(Arc, Base, ARC_USDC)).toThrow(REFUSAL);
  });

  it("the Portal helpers refuse a hand-built one before encoding anything", () => {
    const valid = routes.assembleIntent(requireChain("arc"), requireChain("base"), undefined, {
      creator: CREATOR,
      prover: ecoRoutesProver("arc", "base"),
      deadline: 2_000_003_600n,
      nativeAmount: 0n,
      tokens: [{ token: ARC_USDC, amount }],
    });
    const intent = { ...valid, reward: { ...valid.reward, nativeAmount: oneUsdcNative } };
    expect(() => routes.publishAndFundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.approvalTxs(intent, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.fundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.publishTx(intent, { portal: PORTAL })).toThrow(REFUSAL);
  });

  it("an intent a program opens on Arc is refused when it is compiled", () => {
    expect(() => compileOn("arc", "Base")).toThrow(REFUSAL);
  });

  it("the same shape is fine on Base, whose native coin is not a token", () => {
    expect(both(Base, Arc, BASE_USDC).program.bytecode.length).toBeGreaterThan(0);
    expect(compileOn("base", "Arbitrum").compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

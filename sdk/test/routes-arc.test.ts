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
/** The bytecode of `program` on `chain`, every address in it written out. */
const spelled = (chain: string, program: string): Uint8Array =>
  routes.compileSauceRoute(chain, program, { pot: SHARED_POT, engine: ENGINE }).compiled
    .bytecode[0]!;

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
    // Arc's USDC approving Arc's router: the program spelled with both addresses.
    expect(compiled.compiled.bytecode[0]).toEqual(
      spelled("arc", `Token(${ARC_USDC}).approve(${ARC_SWAP_ROUTER02}, 1_000_000n);`),
    );
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
    const arcRouter = "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1";
    expect(onArc.compiled.bytecode[0]).toEqual(
      spelled("arc", `Token(${ARC_USDC}).approve(${arcRouter}, 1_000_000n);`),
    );
    const baseRouter = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
    expect(onBase.compiled.bytecode[0]).toEqual(
      spelled("base", `Token(${BASE_USDC}).approve(${baseRouter}, 1_000_000n);`),
    );
  });
});

describe("Arc: intents", () => {
  const recipient = 0x2222222222222222222222222222222222222222n;
  const amount = 1_000_000n;

  it("Base -> Arc: a typed closure records the shared Portal and cooks on the shared Pot", () => {
    const built = Arc(
      () => {
        USDC.transfer(recipient, amount);
      },
      {
        deadline: 2_000_000_000n,
        defines: { recipient, amount },
        execution: { value: ARC_EXECUTION_FEE },
        nativeAmount: ARC_EXECUTION_FEE,
        tokens: [{ token: ARC_USDC, amount }],
      },
    ).reward({
      source: Base.chain,
      creator: CREATOR,
      prover: ecoRoutesProver("base", "arc"),
      deadline: 2_000_003_600n,
      tokens: [{ token: BASE_USDC, amount }],
    });

    expect(built.intent.destination).toBe(5042n);
    expect(evm(built.intent.route.portal)).toBe(PORTAL);
    expect(ecoRoutesPortal("arc")).toBe(PORTAL);
    const [cook] = built.intent.route.calls;
    expect(evm(cook!.target)).toBe(SHARED_POT);
    expect(destinationPot("arc")).toBe(SHARED_POT);
    expect(destinationPot("base")).toBe(SHARED_POT);
    expect(cook!.value).toBe(ARC_EXECUTION_FEE);
    expect(built.intent.route.nativeAmount).toBe(ARC_EXECUTION_FEE);
    const decoded = decodeFunctionData({ abi: v12Pot.abi, data: cook!.data as Hex });
    expect(decoded.args?.[0]).toBe(v12EngineAddress());
    expect(decoded.args?.[1]).toBe(bytesToHex(built.compiled.bytecode[0]!));
    // Published and funded on the SOURCE chain's Portal: Base's, the same address.
    expect(getAddress(built.publishAndFundCalldata(false).to)).toBe(PORTAL);
    expect(built.hash().intentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Arc -> Base: a native reward funds on Arc's Portal as 18-decimal USDC value", () => {
    const oneUsdcNative = 10n ** 18n;
    const built = Base("USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);", {
      deadline: 2_000_000_000n,
      execution: { value: 1n },
      nativeAmount: 1n,
    }).reward({
      source: Arc.chain,
      creator: CREATOR,
      prover: ecoRoutesProver("arc", "base"),
      deadline: 2_000_003_600n,
      nativeAmount: oneUsdcNative,
    });

    expect(built.intent.destination).toBe(8453n);
    expect(evm(built.intent.route.portal)).toBe(PORTAL);
    expect(evm(built.intent.route.calls[0]!.target)).toBe(destinationPot("base"));
    const fund = built.publishAndFundCalldata(false);
    expect(getAddress(fund.to)).toBe(PORTAL);
    expect(fund.value).toBe(oneUsdcNative);
    // Native value only: there is no token leg to approve.
    expect(built.approvals()).toHaveLength(0);
  });

  it("Arc -> Base: a USDC token reward is approved through Arc's ERC-20 interface", () => {
    const built = Base("USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);", {
      deadline: 2_000_000_000n,
      execution: { value: 1n },
      nativeAmount: 1n,
    }).reward({
      source: Arc.chain,
      creator: CREATOR,
      prover: ecoRoutesProver("arc", "base"),
      deadline: 2_000_003_600n,
      tokens: [{ token: ARC_USDC, amount }],
    });

    const fund = built.publishAndFundCalldata(false);
    expect(getAddress(fund.to)).toBe(PORTAL);
    expect(fund.value).toBe(0n);
    // In 6-decimal units, through the ERC-20 face of the same balance.
    const approvals = built.approvals();
    expect(approvals).toHaveLength(1);
    expect(getAddress(approvals[0]!.to)).toBe(ARC_USDC);
  });

  it("both directions share the prover eco-routes deploys on both ends", () => {
    expect(ecoRoutesProver("base", "arc")).toBe(ecoRoutesProver("arc", "base"));
  });
});

describe("Arc: a reward cannot offer native value and USDC together", () => {
  const amount = 1_000_000n;
  const oneUsdcNative = 10n ** 18n;
  const BASE_ROUTE = "USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);";
  const REFUSAL =
    /arc \(chain 5042\) offers both a nativeAmount and a USDC token leg \(0x3600000000000000000000000000000000000000\)[\s\S]*RewardTokensNotUnique[\s\S]*Fold them into one leg/;
  const route = { deadline: 2_000_000_000n, execution: { value: 1n }, nativeAmount: 1n } as const;
  const reward = (source: typeof Arc.chain, destination: string, token: Hex) => ({
    source,
    creator: CREATOR as Hex,
    prover: ecoRoutesProver(source.slug, destination),
    deadline: 2_000_003_600n,
    nativeAmount: oneUsdcNative,
    tokens: [{ token, amount }],
  });
  /** A program that opens an intent to `destination`, rewarded in native value AND its own chain's
   *  USDC. */
  const program = (destination: string) => `
    function main() {
      const amount = USDC.balanceOf(ctx.self());
      ${destination}(() => {
        USDC.transfer(RECIPIENT, amount);
      }).reward({ nativeAmount: 1n, tokens: [{ token: USDC, amount }] });
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
        intents: { deadline: 2_000_000_000n, creator: CREATOR, executionFee: 1n },
      },
    );

  it("the builder refuses it at .reward(), naming the chain, the token and the remedy", () => {
    expect(() => Base(BASE_ROUTE, route).reward(reward(Arc.chain, "base", ARC_USDC))).toThrow(
      REFUSAL,
    );
  });

  it("the Portal helpers refuse a hand-built one before encoding anything", () => {
    const built = Base(BASE_ROUTE, route).reward({
      ...reward(Arc.chain, "base", ARC_USDC),
      nativeAmount: 0n,
    });
    const intent = {
      ...built.intent,
      reward: { ...built.intent.reward, nativeAmount: oneUsdcNative },
    };
    expect(() => routes.publishAndFundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.approvalTxs(intent, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.fundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.publishTx(intent, { portal: PORTAL })).toThrow(REFUSAL);
  });

  it("an intent a program opens on Arc is refused when it is compiled", () => {
    expect(() => compileOn("arc", "Base")).toThrow(REFUSAL);
  });

  it("the same shape is fine on Base, whose native coin is not a token", () => {
    const built = Arc(BASE_ROUTE, route).reward(reward(Base.chain, "arc", BASE_USDC));
    expect(built.publishAndFundCalldata(false).value).toBe(oneUsdcNative);
    expect(built.approvals()).toHaveLength(1);
    expect(compileOn("base", "Arbitrum").compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

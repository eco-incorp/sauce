/**
 * Arc (5042) end to end through the public surface: the named `Arc` export and a typed closure on
 * it, Arc's chain-scoped defines, and intents in both directions between Base and Arc.
 *
 * Arc's eco-routes Portal is not the one the other chains share, so an intent to Arc records Arc's
 * Portal and cooks on the Pot its Executor owns; an intent from Arc publishes and funds on Arc's
 * Portal, with native value in USDC at 18 decimals. Offline: every address below was read from the
 * chain (see deployments-pot.test.ts) or comes from the registries.
 */
import { bytesToHex, decodeFunctionData, getAddress, type Hex } from "viem";

import { Arc, Base, destinationPot, requireChain, routes } from "../src/index.js";
import { chainDefines } from "../src/routes/ambient.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { v12Pot } from "../src/evm/engine.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";

const ARC_PORTAL = "0xEC002CA16cE20c2a9F3C6200EF04E7d92a3dfBD8";
const BASE_PORTAL = "0xEC000064576f9C95a8623Bc0eff3db6d296ea6df";
const ARC_POT = "0xBDbbf86bC1D8afE1b382Eee56f5d733AC7bd43a5";
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
      { pot: ARC_POT, engine: ENGINE, value: ARC_EXECUTION_FEE },
      { defines: chainDefines(requireChain("arc")) },
    );
    expect(compiled.source).toContain("__sauce_approve(USDC, ");
    expect(compiled.source).toContain(decimal(ARC_SWAP_ROUTER02));
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(compiled.calls).toHaveLength(1);
    expect(evm(compiled.calls[0]!.target)).toBe(ARC_POT);
    // The Kitchen fee rides as native value, unscaled: on Arc that is 18-decimal USDC.
    expect(compiled.calls[0]!.value).toBe(ARC_EXECUTION_FEE);
  });

  it("the same body resolves Base's contracts on Base", () => {
    const onBase = routes.compileSauceRoute(
      "base",
      "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);",
      { pot: ARC_POT, engine: ENGINE },
    );
    const onArc = routes.compileSauceRoute(
      "arc",
      "USDC.approve(Uniswap.UniversalRouter, 1_000_000n);",
      { pot: ARC_POT, engine: ENGINE },
    );
    expect(onArc.source).toContain(decimal("0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1"));
    expect(onBase.source).not.toContain(decimal("0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1"));
  });
});

describe("Arc: intents", () => {
  const recipient = 0x2222222222222222222222222222222222222222n;
  const amount = 1_000_000n;

  it("Base -> Arc: a typed closure records Arc's Portal and cooks on Arc's own Pot", () => {
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
    expect(evm(built.intent.route.portal)).toBe(ARC_PORTAL);
    expect(ecoRoutesPortal("arc")).toBe(ARC_PORTAL);
    const [cook] = built.intent.route.calls;
    expect(evm(cook!.target)).toBe(ARC_POT);
    expect(destinationPot("arc")).toBe(ARC_POT);
    expect(cook!.value).toBe(ARC_EXECUTION_FEE);
    expect(built.intent.route.nativeAmount).toBe(ARC_EXECUTION_FEE);
    const decoded = decodeFunctionData({ abi: v12Pot.abi, data: cook!.data as Hex });
    expect(decoded.args?.[0]).toBe(v12EngineAddress());
    expect(decoded.args?.[1]).toBe(bytesToHex(built.compiled.bytecode[0]!));
    // Published and funded on the SOURCE chain's Portal: Base's.
    expect(getAddress(built.publishAndFundCalldata(false).to)).toBe(BASE_PORTAL);
    expect(built.hash().intentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Arc -> Base: funds on Arc's Portal with native value in 18-decimal USDC", () => {
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
      tokens: [{ token: ARC_USDC, amount }],
    });

    expect(built.intent.destination).toBe(8453n);
    expect(evm(built.intent.route.portal)).toBe(BASE_PORTAL);
    expect(evm(built.intent.route.calls[0]!.target)).toBe(destinationPot("base"));
    const fund = built.publishAndFundCalldata(false);
    expect(getAddress(fund.to)).toBe(ARC_PORTAL);
    expect(fund.value).toBe(oneUsdcNative);
    // The USDC reward is approved through Arc's ERC-20 interface, in 6-decimal units.
    const approvals = built.approvals();
    expect(approvals).toHaveLength(1);
    expect(getAddress(approvals[0]!.to)).toBe(ARC_USDC);
  });

  it("both directions share the prover eco-routes deploys on both ends", () => {
    expect(ecoRoutesProver("base", "arc")).toBe(ecoRoutesProver("arc", "base"));
  });
});

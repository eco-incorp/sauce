/**
 * Arc (5042) through the public surface: the named `Arc` export, Arc's chain-scoped defines, and
 * the rewards an intent from Arc may offer.
 *
 * An intent from Arc publishes and funds on Arc's Portal, with native value in USDC at 18 decimals.
 * Arc's Portal aliases that native coin to the USDC ERC-20, so a reward offers native
 * value or the USDC token, never both: one with a native amount and a USDC leg reverts
 * `RewardTokensNotUnique(USDC)` at publish (read with an `eth_call` on Arc). Offline: every address
 * below was read from the chain or comes from the registries; Pot predictions use Kitchen 1.1.0
 * release initcode (see deployments-pot.test.ts), pending deployment.
 */
import { getAddress, type Hex } from "viem";

import { Arc, Base, requireChain, routes } from "../src/index.js";
import { chainDefines } from "../src/routes/ambient.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";

const PORTAL = "0xEC000769A73b70e16f361a442292500b3BCf4A85";
const SHARED_POT = "0x6340080a1967a03cAAD490a170828d4C59EE5983";
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

describe("Arc: a reward cannot offer native value and USDC together", () => {
  const amount = 1_000_000n;
  const oneUsdcNative = 10n ** 18n;
  const REFUSAL =
    /arc \(chain 5042\) offers both a nativeAmount and a USDC token leg \(0x3600000000000000000000000000000000000000\)[\s\S]*RewardTokensNotUnique[\s\S]*Fold them into one leg/;
  const reward = (source: typeof Arc.chain, destination: string, token: Hex) => ({
    creator: CREATOR as Hex,
    prover: ecoRoutesProver(source.slug, destination),
    deadline: 2_000_003_600n,
    nativeAmount: oneUsdcNative,
    tokens: [{ token, amount }],
  });

  it("an intent is refused when it is assembled, naming the chain, the token and the remedy", () => {
    expect(() =>
      routes.assembleIntent(Arc.chain, Base.chain, undefined, reward(Arc.chain, "base", ARC_USDC)),
    ).toThrow(REFUSAL);
  });

  it("the Portal helpers refuse a hand-built one before encoding anything", () => {
    const assembled = routes.assembleIntent(Arc.chain, Base.chain, undefined, {
      ...reward(Arc.chain, "base", ARC_USDC),
      nativeAmount: 0n,
    });
    const intent = {
      ...assembled,
      reward: { ...assembled.reward, nativeAmount: oneUsdcNative },
    };
    expect(() => routes.publishAndFundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.approvalTxs(intent, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.fundTx(intent, false, { portal: PORTAL })).toThrow(REFUSAL);
    expect(() => routes.publishTx(intent, { portal: PORTAL })).toThrow(REFUSAL);
  });

  it("the same shape is fine on Base, whose native coin is not a token", () => {
    const intent = routes.assembleIntent(
      Base.chain,
      Arc.chain,
      undefined,
      reward(Base.chain, "arc", BASE_USDC),
    );
    expect(routes.publishAndFundTx(intent, false, { portal: PORTAL }).value).toBe(oneUsdcNative);
    expect(routes.approvalTxs(intent, { portal: PORTAL })).toHaveLength(1);
  });
});

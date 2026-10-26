/**
 * Registry rows found wrong against the chains (live `eth_getCode` / `eth_call`, 2026-10-26), each
 * pinned so the wrong one cannot come back:
 *
 * - Seamless wound down in 2026 (UI offline 2026-07-01), and the registry's `poolAddressesProvider`
 *   never was the pool's (`ADDRESSES_PROVIDER()` answers a different address): the protocol is gone.
 * - Yearn V3's v3.0.4 `vaultFactory` ends `…C88fb277D812F` (docs.yearn.fi, v3 contract addresses);
 *   the registry had `…C89fb277D812F`, an address with no code.
 * - Beefy's BIFI is native on Ethereum alone (docs.beefy.finance, $BIFI token). Polygon's row has
 *   no code; Base's address is the bridged xERC-20 mooBIFI, the same contract address as
 *   Optimism's mooBIFI, not BIFI.
 * - Sommelier's `cellarRouter` was the ETH-BTC Trend Cellar (a vault whose verified contract is
 *   named `Cellar`); the V1.5 Cellar Router is `0x1D90…e889` (Sommelier's smart-contract addresses).
 * - Lido's wstETH on Arbitrum is the bridged `ERC20Bridged`: `wrap`, `unwrap` and the stETH rate
 *   revert there, so it binds its own ABI instead of Ethereum's `WstETH`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deployments as beefy } from "../src/protocols/beefy/addresses.js";
import { WstETHABI, WstETHBridgedABI } from "../src/protocols/lido/abis.js";
import { deployments as sommelier } from "../src/protocols/sommelier/addresses.js";
import { deployments as yearn } from "../src/protocols/yearn-v3/addresses.js";
import { getProtocol, listProtocolSlugs } from "../src/protocols/index.js";
import { compileSauceProgram, sourceGlobals } from "../src/routes/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(
  readFileSync(join(here, "fixtures", "registry-abi", "targets.json"), "utf8"),
).protocols as Record<string, Record<string, { roles?: string[]; chains?: number[] }>>;

const fnNames = (abi: readonly { type: string; name?: string }[]): string[] =>
  abi
    .filter((item) => item.type === "function")
    .map((item) => item.name!)
    .sort();

describe("Seamless is gone", () => {
  it("is not in the registry, and Base names no Seamless contract", () => {
    expect(getProtocol("seamless")).toBeUndefined();
    expect(listProtocolSlugs()).not.toContain("seamless");
    expect(targets.seamless).toBeUndefined();
    const base = sourceGlobals("base");
    expect(base.protocols.map((namespace) => namespace.namespace)).not.toContain("Seamless");
  });
});

describe("Yearn V3: the v3.0.4 VaultFactory", () => {
  it("is Yearn's published address", () => {
    expect(yearn).toEqual([
      {
        chainId: 1,
        chainName: "Ethereum",
        addresses: { vaultFactory: "0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F" },
      },
    ]);
  });
});

describe("Beefy: BIFI where BIFI is a token", () => {
  const chains = beefy.map((d) => d.chainId);

  it("has no Polygon row (no code) and no Base row (the bridged mooBIFI)", () => {
    expect(chains).not.toContain(137);
    expect(chains).not.toContain(8453);
  });

  it("keeps Ethereum's BIFI, the native token", () => {
    expect(beefy.find((d) => d.chainId === 1)?.addresses.BIFI).toBe(
      "0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1",
    );
  });
});

describe("Sommelier: cellarRouter is the Cellar Router", () => {
  it("is the V1.5 Cellar Router, not a Cellar", () => {
    expect(sommelier).toEqual([
      {
        chainId: 1,
        chainName: "Ethereum",
        addresses: { cellarRouter: "0x1D90366B0154fBcB5101c06a39c25D26cB48e889" },
      },
    ]);
  });
});

describe("Lido: each chain's wstETH has the ABI it implements", () => {
  it("binds Ethereum's WstETH to Ethereum alone and the bridged token to Arbitrum", () => {
    expect(targets.lido!.WstETHABI).toMatchObject({ roles: ["wstETH"], chains: [1] });
    expect(targets.lido!.WstETHBridgedABI).toMatchObject({ roles: ["wstETH"], chains: [42161] });
  });

  it("declares the bridged token's functions: ERC-20, allowance steps and its bridge", () => {
    expect(fnNames(WstETHBridgedABI)).toEqual([
      "allowance",
      "approve",
      "balanceOf",
      "bridge",
      "decimals",
      "decreaseAllowance",
      "increaseAllowance",
      "name",
      "symbol",
      "totalSupply",
      "transfer",
      "transferFrom",
    ]);
    // None of WstETH's wrapping or rate functions, which the bridged token does not have.
    const wrapped = new Set(fnNames(WstETHABI));
    expect(fnNames(WstETHBridgedABI).filter((name) => wrapped.has(name))).toEqual([]);
  });

  it("names WstETH on Ethereum and WstETHBridged on Arbitrum, each with its own methods", () => {
    const [ethereum, arbitrum] = ["ethereum", "arbitrum"].map(
      (chain) =>
        sourceGlobals(chain).protocols.find((namespace) => namespace.namespace === "Lido")!
          .contracts,
    );
    if (ethereum === undefined || arbitrum === undefined) throw new Error("no Lido namespace");
    expect(ethereum.map((c) => c.name)).toContain("WstETH");
    expect(ethereum.map((c) => c.name)).not.toContain("WstETHBridged");
    expect(arbitrum.map((c) => c.name)).toContain("WstETHBridged");
    expect(arbitrum.map((c) => c.name)).not.toContain("WstETH");
    const methods = arbitrum.find((c) => c.name === "WstETHBridged")!.methods.map((m) => m.name);
    expect(methods).toContain("balanceOf");
    expect(methods).not.toContain("wrap");
    expect(methods).not.toContain("unwrap");
    expect(ethereum.find((c) => c.name === "WstETH")!.methods.map((m) => m.name)).toContain("wrap");
  });

  it("compiles wrap on Ethereum only, and the bridged token's reads on Arbitrum", () => {
    const wrap = "function main(a: Uint256): Uint256 { return Lido.WstETH.wrap(a); }";
    expect(compileSauceProgram("ethereum", wrap).bytecode.length).toBeGreaterThan(0);
    expect(() => compileSauceProgram("arbitrum", wrap)).toThrow(/not deployed on 'arbitrum'/);
    expect(() =>
      compileSauceProgram(
        "arbitrum",
        "function main(a: Uint256): Uint256 { return Lido.WstETHBridged.wrap(a); }",
      ),
    ).toThrow(/'wrap' is not in lido\.WstETHBridged/);
    const balance =
      "function main(a: Address): Uint256 { return Lido.WstETHBridged.balanceOf(a); }";
    expect(compileSauceProgram("arbitrum", balance).bytecode.length).toBeGreaterThan(0);
  });

  it("carries no exemption for Arbitrum on Ethereum's ABI", () => {
    expect(targets.lido!.WstETHABI).not.toHaveProperty("exempt");
  });
});

/**
 * The registry templates the docs review changed compile through the real compiler, as shipped,
 * and call the function they say they call.
 *
 * Each template imports its protocol's ABI from `./abis`; `compileSauceFunctionRust` serves that
 * export of the protocol's `abis.ts` there, as the registry compiles them. A compiled call carries
 * its 4-byte selector in the bytecode, so each case also asserts the selector it must call and, for
 * the bridges, that the sender-default form (EOA-only, so it reverts from a Pot) is not called.
 */
import { join, resolve } from "node:path";

import * as aevo from "../src/protocols/aevo/functions.js";
import * as baseBridge from "../src/protocols/base-bridge/functions.js";
import * as gmxV1 from "../src/protocols/gmx-v1/functions.js";
import * as optimismBridge from "../src/protocols/optimism-bridge/functions.js";
import { compileSauceFunctionRust, computeSelector } from "./helpers.js";

const PROTOCOLS = resolve(process.cwd(), "src", "protocols");
const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const selector = (signature: string): string => computeSelector(signature).slice(2);

const DEPOSIT_ETH_TO = "depositETHTo(address,uint32,bytes)";
const DEPOSIT_ERC20_TO = "depositERC20To(address,address,address,uint256,uint32,bytes)";
const DEPOSIT_ETH = "depositETH(uint32,bytes)";
const DEPOSIT_ERC20 = "depositERC20(address,address,uint256,uint32,bytes)";
const INCREASE =
  "createIncreasePosition(address[],address,uint256,uint256,uint256,bool,uint256,uint256,bytes32,address)";
const DECREASE =
  "createDecreasePosition(address[],address,uint256,uint256,bool,address,uint256,uint256,uint256,bool,address)";

describe("changed registry templates compile through the real compiler", () => {
  it.each([
    ["base-bridge", "depositETH", DEPOSIT_ETH_TO, baseBridge.depositETH, [DEPOSIT_ETH]],
    ["base-bridge", "depositERC20", DEPOSIT_ERC20_TO, baseBridge.depositERC20, [DEPOSIT_ERC20]],
    ["optimism-bridge", "depositETH", DEPOSIT_ETH_TO, optimismBridge.depositETH, [DEPOSIT_ETH]],
    [
      "optimism-bridge",
      "depositERC20",
      DEPOSIT_ERC20_TO,
      optimismBridge.depositERC20,
      [DEPOSIT_ERC20],
    ],
    ["gmx-v1", "openPosition", INCREASE, gmxV1.openPosition, []],
    ["gmx-v1", "closePosition", DECREASE, gmxV1.closePosition, []],
    ["gmx-v1", "swap", "swap(address[],uint256,uint256,address)", gmxV1.swap, []],
    ["aevo", "depositERC20", DEPOSIT_ERC20, aevo.depositERC20, []],
  ] as const)("%s %s calls %s", (slug, _name, calls, template, never) => {
    const { bytecode } = compileSauceFunctionRust(template, join(PROTOCOLS, slug));
    expect(bytecode.length).toBeGreaterThan(0);
    const hex = hexOf(bytecode);
    expect(hex).toContain(selector(calls));
    for (const signature of never) expect(hex).not.toContain(selector(signature));
  });

  it("refuses a template whose call does not match the ABI (the harness compiles for real)", () => {
    const broken = gmxV1.openPosition.replace("isLong, acceptablePrice,", "isLong,");
    expect(broken).not.toBe(gmxV1.openPosition);
    expect(() => compileSauceFunctionRust(broken, join(PROTOCOLS, "gmx-v1"))).toThrow();
  });
});

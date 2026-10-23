/**
 * The `transfer` and `approve` actions against tokens that lie about a write, executed through the
 * released engine — OpenZeppelin `SafeERC20` semantics, which the SDK's `token/safe` lowering gives
 * every Sauce token write:
 *
 * - a token that returns NOTHING (USDT) succeeds; a raw binding whose `bool` the program reads
 *   rejects the same empty return data, while an unread result requires no decode;
 * - a token that returns `false` reverts the program, as does a "token" with no code;
 * - approving over a standing non-zero allowance succeeds, because the allowance is reset first —
 *   the change USDT refuses, and the one a shared Pot meets.
 *
 * The tokens are `sdk/test/std/token/fixtures/{NoReturn,FalseReturn}ERC20` (solc 0.8.36). Needs no
 * mainnet state; skips without the engine artifact, fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeAbiParameters,
  getContractAddress,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { compileEvm } from "../src/compile.js";
import { compileProgram } from "../src/index.js";
import type { Action } from "../src/types.js";
import { REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, `sdk/test/std/token/fixtures/${name}.json`), "utf8"),
  ) as { abi: Abi; creationCode: Hex };

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
]);

const SPENDER = "0x4000000000000000000000000000000000000001" as Address;
const RECIPIENT = "0x3000000000000000000000000000000000000001" as Address;
/** An address with no code. */
const NOT_A_TOKEN = "0x4000000000000000000000000000000000000009" as Address;

const skip = skipReason();

describe("ERC-20 writes, checked like SafeERC20", { skip, timeout: 120_000 }, () => {
  let env: Anvil;
  let usdt: Address;
  let liar: Address;

  async function deploy(name: string, args: Hex = "0x"): Promise<Address> {
    const nonce = await env.publicClient.getTransactionCount({ address: env.account.address });
    const receipt = await env.send({
      to: undefined as unknown as Address,
      data: `${fixture(name).creationCode}${args.slice(2)}` as Hex,
    });
    assert.equal(receipt.status, "success");
    const address =
      receipt.contractAddress ??
      getContractAddress({ from: env.account.address, nonce: BigInt(nonce) });
    const mint = await env.walletClient.writeContract({
      address,
      abi: tokenAbi,
      functionName: "mint",
      args: [env.pot, 1_000_000n],
      account: env.account,
      chain: env.chain,
    });
    await env.publicClient.waitForTransactionReceipt({ hash: mint });

    return address;
  }

  before(async () => {
    env = await startAnvil();
    usdt = await deploy(
      "NoReturnERC20",
      encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint8" }],
        ["Tether USD", "USDT", 6],
      ),
    );
    liar = await deploy("FalseReturnERC20");
  });

  after(() => env?.stop());

  const read = (
    token: Address,
    functionName: "balanceOf" | "allowance",
    args: readonly Address[],
  ) =>
    env.publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName,
      args: args as never,
    });

  const run = async (actions: Action[]) =>
    // The anvil is chain 31337, which no registry names: the program has only addresses, so any
    // canonical chain compiles it to the same bytes.
    (await env.cook(compileProgram({ version: 1, actions }, { chain: "ethereum" }).bytecode))
      .status;

  it("approve and transfer succeed on a token that returns nothing, and move exactly what they say", async () => {
    const status = await run([
      { type: "approve", amount: "250000", token: usdt, spender: SPENDER },
      { type: "transfer", amount: "100000", token: usdt, recipient: RECIPIENT },
    ]);
    assert.equal(status, "success");
    assert.equal(await read(usdt, "allowance", [env.pot, SPENDER]), 250_000n);
    assert.equal(await read(usdt, "balanceOf", [RECIPIENT]), 100_000n);
    assert.equal(await read(usdt, "balanceOf", [env.pot]), 900_000n);
  });

  it("approving over a standing allowance resets it first, so USDT's rule does not revert it", async () => {
    // The previous test left 250000 approved; USDT refuses a non-zero to non-zero change.
    assert.equal(
      await run([{ type: "approve", amount: "1", token: usdt, spender: SPENDER }]),
      "success",
    );
    assert.equal(await read(usdt, "allowance", [env.pot, SPENDER]), 1n);
  });

  it("a balanceOf source action feeds a transfer of the whole balance", async () => {
    const before = await read(usdt, "balanceOf", [env.pot]);
    const status = await run([
      { type: "balanceOf", token: usdt },
      { type: "transfer", token: usdt, recipient: RECIPIENT },
    ]);
    assert.equal(status, "success");
    assert.equal(await read(usdt, "balanceOf", [env.pot]), 0n);
    assert.equal(await read(usdt, "balanceOf", [RECIPIENT]), 100_000n + before);
  });

  it("a token that returns false reverts the program, for a transfer and an approve", async () => {
    const transfer = await run([
      { type: "transfer", amount: "1", token: liar, recipient: RECIPIENT },
    ]);
    const approve = await run([{ type: "approve", amount: "1", token: liar, spender: SPENDER }]);
    assert.equal(transfer, "reverted");
    assert.equal(approve, "reverted");
  });

  it("a transfer of a token with no code reverts rather than succeeding silently", async () => {
    const status = await run([
      { type: "transfer", amount: "1", token: NOT_A_TOKEN, recipient: RECIPIENT },
    ]);
    assert.equal(status, "reverted");
  });

  it("reading a bool-declaring approve result reverts on USDT and undoes its allowance", async () => {
    const IERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
    const other = "0x4000000000000000000000000000000000000002";
    const program = compileEvm(
      `function main(): void {\n  require(IErc20Bool.at(${usdt}n).approve(${other}n, 5n) != 0);\n}\n`,
      { IErc20Bool: { abi: JSON.parse(JSON.stringify(IERC20)) } },
    ).bytecode;
    const receipt = await env.cook(program);
    assert.equal(receipt.status, "reverted", "a bool decode of empty return data should revert");
    assert.equal(await read(usdt, "allowance", [env.pot, other]), 0n);
  });
});

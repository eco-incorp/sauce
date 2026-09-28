/**
 * Tokens whose `transfer`/`approve` return NOTHING — USDT on Ethereum is the one that matters —
 * executed through the released engine.
 *
 * Compiler 2.3.0 decodes a binding's declared `bool` output even when the program discards it, and
 * decoding from empty return data reverts on this engine. So `transfer`/`approve` are bound
 * output-free (`abis.ts`), and this suite is the proof: the actions succeed against a no-return
 * token, and the same approve through a `bool`-declaring binding reverts — the trap they avoid.
 *
 * The token is `sdk/test/std/token/fixtures/NoReturnERC20` (solc 0.8.36), byte-identical to the
 * fixture PR #4 adds for the settle recipe. Fork-free; skips without the engine artifact, fails in CI.
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
import { actionsToSauce } from "../src/to-sauce.js";
import { REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";

const fixture = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "sdk/test/std/token/fixtures/NoReturnERC20.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
]);

const SPENDER = "0x4000000000000000000000000000000000000001" as Address;
const RECIPIENT = "0x3000000000000000000000000000000000000001" as Address;

const skip = skipReason();

describe("no-return tokens (USDT-style)", { skip, timeout: 120_000 }, () => {
  let env: Anvil;
  let token: Address;

  before(async () => {
    env = await startAnvil();
    const nonce = await env.publicClient.getTransactionCount({ address: env.account.address });
    const args = encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }],
      ["Tether USD", "USDT", 6],
    );
    const deploy = await env.send({
      to: undefined as unknown as Address,
      data: `${fixture.creationCode}${args.slice(2)}` as Hex,
    });
    assert.equal(deploy.status, "success");
    token =
      deploy.contractAddress ??
      getContractAddress({ from: env.account.address, nonce: BigInt(nonce) });
    const mint = await env.walletClient.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "mint",
      args: [env.pot, 1_000_000n],
      account: env.account,
      chain: env.chain,
    });
    await env.publicClient.waitForTransactionReceipt({ hash: mint });
  });

  after(() => env?.stop());

  const read = (functionName: "balanceOf" | "allowance", args: readonly Address[]) =>
    env.publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName,
      args: args as never,
    });

  it("approve and transfer actions succeed, and move exactly what they say", async () => {
    const receipt = await env.cook(
      actionsToSauce([
        { type: "approve", chainId: 31337, token, spender: SPENDER, amount: "250000" },
        { type: "transfer", chainId: 31337, token, to: RECIPIENT, amount: "100000" },
      ]),
    );
    assert.equal(receipt.status, "success");
    assert.equal(await read("allowance", [env.pot, SPENDER]), 250_000n);
    assert.equal(await read("balanceOf", [RECIPIENT]), 100_000n);
    assert.equal(await read("balanceOf", [env.pot]), 900_000n);
  });

  it("a balanceOf source action feeds a transfer of the whole balance", async () => {
    const before = await read("balanceOf", [env.pot]);
    const receipt = await env.cook(
      actionsToSauce([
        { type: "balanceOf", chainId: 31337, token },
        { type: "transfer", chainId: 31337, token, to: RECIPIENT },
      ]),
    );
    assert.equal(receipt.status, "success");
    assert.equal(await read("balanceOf", [env.pot]), 0n);
    assert.equal(await read("balanceOf", [RECIPIENT]), 100_000n + before);
  });

  it("a token refusing the call still reverts the program — only the decode is skipped", async () => {
    // USDT refuses to move a nonzero allowance to another nonzero value.
    const receipt = await env.cook(
      actionsToSauce([{ type: "approve", chainId: 31337, token, spender: SPENDER, amount: "1" }]),
    );
    assert.equal(receipt.status, "reverted");
  });

  it("control: the same approve through a `bool`-declaring binding reverts", async () => {
    const IERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
    const other = "0x4000000000000000000000000000000000000002";
    const program = compileEvm(
      `function main(): void {\n  IErc20Bool.at(${token}n).approve(${other}n, 5n);\n}\n`,
      { IErc20Bool: { abi: JSON.parse(JSON.stringify(IERC20)) } },
    ).bytecode;
    const receipt = await env.cook(program);
    assert.equal(receipt.status, "reverted", "a bool decode of empty return data should revert");
    assert.equal(await read("allowance", [env.pot, other]), 0n);
  });
});

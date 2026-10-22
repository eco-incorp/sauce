/**
 * Action programs composed with the rest of the stack, EXECUTED: one compiled program taking its
 * amount at runtime, ABI-v1 and compact-v1, including a number spliced into a precompiled compact
 * payload at the offset a declared `scalarWidth` fixes.
 *
 * Needs no mainnet state; skips without the engine artifact, fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { compileProgram } from "../src/index.js";
import type { ActionProgram } from "../src/types.js";
import { recordedCalls, recorderCode, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { decodeCompactArguments } from "../../sdk/dist/compact-arguments.js";

const TOKEN = "0x1000000000000000000000000000000000000001" as Address;
const SPENDER = "0x4000000000000000000000000000000000000001" as Address;
const approve = (amount: bigint): Hex =>
  encodeFunctionData({
    abi: parseAbi(["function approve(address,uint256)"]),
    functionName: "approve",
    args: [SPENDER, amount],
  }).toLowerCase() as Hex;

/** approve(SPENDER, <runtime amount>) — the whole program is its argument. */
const parameterized: ActionProgram = {
  version: 1,
  chainId: 1,
  actions: [
    { type: "argument", name: "amount" },
    { type: "approve", token: TOKEN, spender: SPENDER },
  ],
};

const skip = skipReason();

describe("action programs, composed and executed", { skip, timeout: 120_000 }, () => {
  let env: Anvil;

  before(async () => {
    env = await startAnvil();
    await env.testClient.setCode({ address: TOKEN, bytecode: recorderCode() });
  });

  after(() => env?.stop());

  const approvedAmount = async (payload: Uint8Array): Promise<Hex> => {
    const receipt = await env.cook(payload);
    assert.equal(receipt.status, "success");
    const [recorded] = recordedCalls(receipt, [TOKEN]);

    return recorded!.data;
  };

  it("one ABI-v1 program serves every amount", async () => {
    const compiled = compileProgram(parameterized);
    assert.deepEqual(compiled.parameters, ["amount"]);
    assert.equal(compiled.entryEncoding, "abi-v1");
    assert.equal(await approvedAmount(compiled.payload({ amount: 5n })), approve(5n));
    assert.equal(await approvedAmount(compiled.payload({ amount: "900000" })), approve(900_000n));

    // The amount is the 32-byte word at `argumentOffset`: splice one into a built payload.
    const payload = compiled.payload({ amount: 1n });
    const at = compiled.argumentOffset("amount");
    payload.set(Buffer.from(12345n.toString(16).padStart(64, "0"), "hex"), at);
    assert.equal(await approvedAmount(payload), approve(12345n));
  });

  it("compact-v1 with a declared scalarWidth fixes the amount's offset, so a number can be spliced in", async () => {
    const compiled = compileProgram(parameterized, { compactArgs: true });
    assert.equal(compiled.entryEncoding, "compact-v1");
    assert.equal(await approvedAmount(compiled.payload({ amount: 7n })), approve(7n));

    const width = 32;
    const payload = compiled.payload({ amount: 1n }, { scalarWidth: width });
    const at = compiled.argumentOffset("amount", { scalarWidth: width });
    const spliced = 0x5acef00dn;
    payload.set(Buffer.from(spliced.toString(16).padStart(width * 2, "0"), "hex"), at);
    // The strict inverse reads the spliced value back under the same declared width...
    const args = payload.subarray(compiled.bytecode.length);
    assert.deepEqual(decodeCompactArguments(compiled.entrySchema!, args, { scalarWidth: width }), [
      spliced,
    ]);
    // ...and the engine executes it.
    assert.equal(await approvedAmount(payload), approve(spliced));
  });
});

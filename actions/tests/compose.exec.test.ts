/**
 * Action programs composed with the rest of the stack, EXECUTED:
 *
 *   - one compiled program taking its amount at runtime, including a number spliced into a
 *     precompiled payload at the amount's fixed offset;
 *   - an action program built into an Eco intent by `programIntent`, whose route call — the SDK's
 *     own `Pot.cook(engine, program)` — runs on the engine.
 *
 * Needs no mainnet state; skips without the engine artifact, fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { compileProgram, programIntent } from "../src/index.js";
import type { ActionProgram } from "../src/types.js";
import { recordedCalls, recorderCode, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { denormalizeToEvm } from "../../sdk/dist/routes/index.js";

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
    assert.equal(await approvedAmount(compiled.payload({ amount: 5n })), approve(5n));
    assert.equal(await approvedAmount(compiled.payload({ amount: "900000" })), approve(900_000n));

    // The amount is the 32-byte word at `argumentOffset`: splice one into a built payload.
    const payload = compiled.payload({ amount: 1n });
    const at = compiled.argumentOffset("amount");
    payload.set(Buffer.from(12345n.toString(16).padStart(64, "0"), "hex"), at);
    assert.equal(await approvedAmount(payload), approve(12345n));
  });

  it("an action program is an intent route, and its cook runs on the engine", async () => {
    const program: ActionProgram = {
      version: 1,
      chainId: 1,
      actions: [{ type: "approve", amount: "31337", token: TOKEN, spender: SPENDER }],
    };
    const built = programIntent(program, {
      pot: env.pot,
      engine: env.engine,
      deadline: 2_000_000_000n,
      portal: "0x5000000000000000000000000000000000000001",
    }).reward({
      source: "base",
      creator: "0x5000000000000000000000000000000000000002",
      prover: "0x5000000000000000000000000000000000000003",
      deadline: 2_000_000_000n,
      nativeAmount: 1n,
    });

    const [cook] = built.intent.route.calls;
    assert.equal(denormalizeToEvm(cook!.target).toLowerCase(), env.pot.toLowerCase());
    const { functionName } = decodeFunctionData({
      abi: parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]),
      data: cook!.data,
    });
    assert.equal(functionName, "cook");

    const receipt = await env.send({ to: env.pot, data: cook!.data, value: cook!.value });
    assert.equal(receipt.status, "success");
    assert.equal(recordedCalls(receipt, [TOKEN])[0]!.data, approve(31337n));
  });
});

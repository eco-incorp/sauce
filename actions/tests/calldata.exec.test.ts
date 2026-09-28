/**
 * Every action, EXECUTED through the released engine and a real Pot, against contracts that record
 * the calls they receive — then each recorded call compared byte for byte with an independent viem
 * encoding of the Solidity call the action is meant to make.
 *
 * This is the spec for the emitted calldata, and it needs no mainnet state: the recorders stand in
 * for the protocols (see `anvil.ts#recorderCode`): every write returns `true`, which covers each
 * output a binding declares and the check an ERC-20 write makes. View calls — balance and allowance
 * reads, the bridge fee quotes — are answered but not recorded (a view call is a STATICCALL, which
 * cannot log), so a balance delta shows only the call between its reads. The expected encodings below are written from the
 * protocols' Solidity signatures, not from `abis.ts`, so a wrong fragment there fails here.
 *
 * It runs in `test:unit`; it skips locally without the engine artifact and fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  pad,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { compileProgram } from "../src/index.js";
import type { Action, ActionType } from "../src/types.js";
import { recordedCalls, recorderCode, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { A, B, B32, D, R, SAMPLES, T, ZERO } from "./samples.js";

const RECORDERS = [T, A, B] as Address[];

/** Every sample spends this much. */
const AMOUNT = 1000n;
const MIN = 1n;
const DEADLINE = BigInt(D);
/** What every recorded call returns: `true`, which an ERC-20 write requires. */
const TRUE = pad("0x01");
/** What a fee quote answers: 42 — twice for Stargate's (nativeFee, lzTokenFee). */
const FEE = pad("0x2a");
const MAX_INT256 = (1n << 255n) - 1n;

const call = (abi: string, name: string, args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: parseAbi([abi]) as Abi, functionName: name, args });

interface Expected {
  readonly to: string;
  readonly data: Hex;
  readonly value?: bigint;
}

/** The calls an action makes, in order, given the executing Pot's address. */
type Expect = (pot: Address) => readonly Expected[];

const V4_KEY = { currency0: A, currency1: B, fee: 500, tickSpacing: 10, hooks: ZERO } as const;

/** The Universal Router input of a V4 swap: swap, settle from the router's own balance, take all. */
function v4Execute(swapAction: number, swapParams: Hex, to: string): Hex {
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [A, 1n << 255n, false],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [B, to as Address, 0n], // OPEN_DELTA is 0
  );
  const input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [`0x${swapAction.toString(16).padStart(2, "0")}0b0e`, [swapParams, settle, take]],
  );

  return call("function execute(bytes, bytes[])", "execute", ["0x10", [input]]);
}

const POOL_KEY_ABI = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const SEND_PARAM = "(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)";

/** Each sample's calls; the source actions call nothing. */
const EXPECT: Record<Exclude<ActionType, "balanceOf" | "nativeBalance" | "argument">, Expect> = {
  uniswapV3ExactInput: () => [
    {
      to: T,
      data: call(
        "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        "exactInputSingle",
        [[A, B, 500, R, AMOUNT, MIN, 0n]],
      ),
    },
  ],
  uniswapV3ExactInputMultiHop: (pot) => [
    {
      to: T,
      data: call("function exactInput((bytes,address,uint256,uint256))", "exactInput", [
        [`${A}0001f4${B.slice(2)}`, pot, AMOUNT, MIN],
      ]),
    },
  ],
  uniswapV4ExactInput: () => [
    { to: A, data: call("function transfer(address,uint256)", "transfer", [T, AMOUNT]) },
    {
      to: T,
      data: v4Execute(
        0x06,
        encodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
                { ...POOL_KEY_ABI, name: "poolKey" },
                { name: "zeroForOne", type: "bool" },
                { name: "amountIn", type: "uint128" },
                { name: "amountOutMinimum", type: "uint128" },
                { name: "hookData", type: "bytes" },
              ],
            },
          ],
          [
            {
              poolKey: V4_KEY,
              zeroForOne: true,
              amountIn: AMOUNT,
              amountOutMinimum: MIN,
              hookData: "0x",
            },
          ],
        ),
        R,
      ),
    },
  ],
  uniswapV4ExactInputMultiHop: () => [
    { to: A, data: call("function transfer(address,uint256)", "transfer", [T, AMOUNT]) },
    {
      to: T,
      data: v4Execute(
        0x07,
        encodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
                { name: "currencyIn", type: "address" },
                {
                  name: "path",
                  type: "tuple[]",
                  components: [
                    { name: "intermediateCurrency", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "tickSpacing", type: "int24" },
                    { name: "hooks", type: "address" },
                    { name: "hookData", type: "bytes" },
                  ],
                },
                { name: "amountIn", type: "uint128" },
                { name: "amountOutMinimum", type: "uint128" },
              ],
            },
          ],
          [
            {
              currencyIn: A,
              path: [
                { intermediateCurrency: B, fee: 500, tickSpacing: 10, hooks: ZERO, hookData: "0x" },
              ],
              amountIn: AMOUNT,
              amountOutMinimum: MIN,
            },
          ],
        ),
        R,
      ),
    },
  ],
  // Unrecorded balance reads bracket the swap (both answer 0 here, so the delta is 0), then the
  // delta is forwarded to the recipient. The delta test below makes the reads differ.
  curveSwap: () => [
    {
      to: T,
      data: call("function exchange(int128,int128,uint256,uint256)", "exchange", [
        1n,
        2n,
        AMOUNT,
        MIN,
      ]),
    },
    { to: B, data: call("function transfer(address,uint256)", "transfer", [R, 0n]) },
  ],
  curveRouterNGSwap: () => [
    {
      to: T,
      data: call(
        "function exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)",
        "exchange",
        [
          [A, T, B, ...Array(8).fill(ZERO)],
          [[1n, 2n, 1n, 1n, 3n], ...Array.from({ length: 4 }, () => [0n, 0n, 0n, 0n, 0n])],
          AMOUNT,
          MIN,
          Array(5).fill(ZERO),
          R,
        ],
      ),
    },
  ],
  balancerV2Swap: (pot) => [
    {
      to: T,
      data: call(
        "function swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
        "swap",
        [[B32, 0, A, B, AMOUNT, "0x"], [pot, false, R, false], MIN, DEADLINE],
      ),
    },
  ],
  balancerV2BatchSwap: (pot) => [
    {
      to: T,
      data: call(
        "function batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)",
        "batchSwap",
        [
          0,
          [[B32, 0n, 1n, AMOUNT, "0x"]],
          [A, B],
          [pot, false, R, false],
          [MAX_INT256, -MIN],
          DEADLINE,
        ],
      ),
    },
  ],
  balancerV3Swap: () => [
    {
      to: T,
      data: call(
        "function swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)",
        "swapSingleTokenExactIn",
        [A, A, B, AMOUNT, MIN, DEADLINE, false, "0x"],
      ),
    },
  ],
  uniswapV2Swap: () => [
    {
      to: T,
      data: call(
        "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
        "swapExactTokensForTokens",
        [AMOUNT, MIN, [A, B], R, DEADLINE],
      ),
    },
  ],
  ambientSwap: () => [
    {
      to: T,
      data: call("function userCmd(uint16,bytes)", "userCmd", [
        1,
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint256" },
            { type: "bool" },
            { type: "bool" },
            { type: "uint128" },
            { type: "uint16" },
            { type: "uint128" },
            { type: "uint128" },
            { type: "uint8" },
          ],
          [A, B, 420n, true, true, AMOUNT, 0, 1n, MIN, 0],
        ),
      ]),
    },
  ],
  dodoSwap: () => [
    {
      to: T,
      data: call(
        "function dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)",
        "dodoSwapV1",
        [A, B, AMOUNT, MIN, [T], 0n, false, DEADLINE],
      ),
    },
  ],
  maverickSwap: () => [
    {
      to: T,
      data: call(
        "function exactInputSingle(address,address,bool,uint256,uint256)",
        "exactInputSingle",
        [R, A, true, AMOUNT, MIN],
      ),
    },
  ],
  maverickMultiHopSwap: () => [
    {
      to: T,
      data: call(
        "function exactInputMultiHop(address,bytes,uint256,uint256)",
        "exactInputMultiHop",
        [R, "0xabcd", AMOUNT, MIN],
      ),
    },
  ],
  carbonSwap: () => [
    {
      to: T,
      data: call(
        "function tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)",
        "tradeBySourceAmount",
        [A, B, [[340282366920938463463374607431768211457n, AMOUNT]], DEADLINE, MIN],
      ),
    },
  ],
  fraxswapSwap: () => [
    {
      to: T,
      data: call(
        "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
        "swapExactTokensForTokens",
        [AMOUNT, MIN, [A, B], R, DEADLINE],
      ),
    },
  ],
  fluidDexT1Swap: () => [
    {
      to: T,
      data: call("function swapIn(bool,uint256,uint256,address)", "swapIn", [true, AMOUNT, MIN, R]),
    },
  ],
  // The Pot deposits (and is refunded), and the relayer keeps 10 of the 1000.
  acrossBridge: (pot) => [
    {
      to: T,
      data: call(
        "function depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
        "depositV3",
        [pot, R, A, A, AMOUNT, AMOUNT - 10n, 10n, ZERO, 1, 2, 0, "0x"],
      ),
    },
  ],
  // The quote is a silent static call answering (42, 42); the send pays the native fee, 42.
  stargateBridge: (pot) => [
    {
      to: T,
      data: call(`function send(${SEND_PARAM},(uint256,uint256),address)`, "send", [
        [30110, pad(R), AMOUNT, 990n, "0x", "0x", "0x"],
        [42n, 0n],
        pot,
      ]),
      value: 42n,
    },
  ],
  cctpBridge: () => [
    {
      to: T,
      data: call(
        "function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
        "depositForBurn",
        [AMOUNT, 5, B32, A, pad("0x0"), 0n, 2000],
      ),
    },
  ],
  // The gas quote is a silent static call answering 42, which the transfer pays.
  hyperlaneBridge: () => [
    {
      to: T,
      data: call("function transferRemote(uint32,bytes32,uint256)", "transferRemote", [
        10,
        pad(R),
        AMOUNT,
      ]),
      value: 42n,
    },
  ],
  wrapETH: () => [{ to: T, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  unwrapETH: () => [{ to: T, data: call("function withdraw(uint256)", "withdraw", [AMOUNT]) }],
  wrapStETH: () => [{ to: T, data: call("function wrap(uint256)", "wrap", [AMOUNT]) }],
  unwrapStETH: () => [{ to: T, data: call("function unwrap(uint256)", "unwrap", [AMOUNT]) }],
  lidoStake: () => [
    { to: T, data: call("function submit(address)", "submit", [ZERO]), value: AMOUNT },
  ],
  lidoUnstake: (pot) => [
    {
      to: T,
      data: call("function requestWithdrawals(uint256[],address)", "requestWithdrawals", [
        [AMOUNT],
        pot,
      ]),
    },
  ],
  rocketPoolStake: () => [{ to: T, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  rocketPoolUnstake: () => [{ to: T, data: call("function burn(uint256)", "burn", [AMOUNT]) }],
  etherFiStake: () => [{ to: T, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  aaveV3Supply: (pot) => [
    {
      to: T,
      data: call("function supply(address,uint256,address,uint16)", "supply", [A, AMOUNT, pot, 0]),
    },
  ],
  aaveV3Withdraw: () => [
    {
      to: T,
      data: call("function withdraw(address,uint256,address)", "withdraw", [A, AMOUNT, R]),
    },
  ],
  // Variable rate, the only one Aave V3 offers.
  aaveV3Borrow: () => [
    {
      to: T,
      data: call("function borrow(address,uint256,uint256,uint16,address)", "borrow", [
        A,
        AMOUNT,
        2n,
        0,
        R,
      ]),
    },
  ],
  aaveV3Repay: () => [
    {
      to: T,
      data: call("function repay(address,uint256,uint256,address)", "repay", [A, AMOUNT, 2n, R]),
    },
  ],
  compoundV3Supply: () => [
    { to: T, data: call("function supply(address,uint256)", "supply", [A, AMOUNT]) },
  ],
  compoundV3Withdraw: () => [
    { to: T, data: call("function withdraw(address,uint256)", "withdraw", [A, AMOUNT]) },
  ],
  transfer: () => [
    { to: A, data: call("function transfer(address,uint256)", "transfer", [R, AMOUNT]) },
  ],
  approve: () => [
    { to: A, data: call("function approve(address,uint256)", "approve", [T, AMOUNT]) },
  ],
  permit2Approve: () => [
    {
      to: T,
      data: call("function approve(address,address,uint160,uint48)", "approve", [A, B, AMOUNT, D]),
    },
  ],
};

/** What the paying pool below delivers to the Pot during `exchange`, in wei. */
const DELIVERED = 58n;

/**
 * Two recorders for the curveSwap delta test, so its two balance reads differ. A view is a
 * STATICCALL and cannot change state, so the difference has to come from the swap between them.
 *
 * The token answers `balanceOf(owner)` with `owner`'s NATIVE balance, and records any other call
 * and returns `true`:
 *
 *   PUSH0 CALLDATALOAD PUSH1 0xe0 SHR PUSH4 0x70a08231 EQ PUSH1 0x1e JUMPI
 *   CALLDATASIZE PUSH0 PUSH0 CALLDATACOPY CALLVALUE CALLDATASIZE PUSH0 LOG1
 *   PUSH1 1 PUSH0 MSTORE PUSH1 32 PUSH0 RETURN
 *   0x1e: JUMPDEST PUSH1 4 CALLDATALOAD BALANCE PUSH0 MSTORE PUSH1 32 PUSH0 RETURN
 *
 * The pool records its call, pays its caller (the Pot) `DELIVERED` wei, and returns `true`:
 *
 *   CALLDATASIZE PUSH0 PUSH0 CALLDATACOPY CALLVALUE CALLDATASIZE PUSH0 LOG1
 *   PUSH0 PUSH0 PUSH0 PUSH0 PUSH1 58 CALLER GAS CALL POP
 *   PUSH1 1 PUSH0 MSTORE PUSH1 32 PUSH0 RETURN
 */
const NATIVE_BALANCE_TOKEN: Hex =
  "0x5f3560e01c6370a0823114601e57365f5f3734365fa160015f5260205ff35b600435315f5260205ff3";
const PAYING_POOL: Hex = `0x365f5f3734365fa15f5f5f5f60${DELIVERED.toString(16).padStart(2, "0")}335af15060015f5260205ff3`;

const skip = skipReason();

/** A one-action program's bytecode. */
const compiled = (action: Action): Uint8Array =>
  compileProgram({ version: 1, chainId: 1, actions: [action] }).bytecode;

describe("every action's calldata, executed", { skip, timeout: 120_000 }, () => {
  let env: Anvil;

  /** Recorders at every address the samples call, answering the fee quotes with 42. */
  async function record(views: Record<string, Hex> = {}): Promise<void> {
    for (const recorder of RECORDERS) {
      await env.testClient.setCode({
        address: recorder,
        bytecode: recorderCode(TRUE, {
          [toFunctionSelector(`quoteSend(${SEND_PARAM},bool)`)]: concat([FEE, FEE]),
          [toFunctionSelector("quoteGasPayment(uint32)")]: FEE,
          ...views,
        }),
      });
    }
  }

  before(async () => {
    env = await startAnvil();
    await record();
    await env.testClient.setBalance({ address: env.pot, value: 10n ** 20n });
  });

  after(() => env?.stop());

  for (const [type, expect] of Object.entries(EXPECT)) {
    it(`${type} makes exactly the intended calls`, async () => {
      const receipt = await env.cook(compiled(SAMPLES[type as ActionType]));
      assert.equal(receipt.status, "success", `${type}: the program reverted`);
      const calls = recordedCalls(receipt, RECORDERS);
      const expected = expect(env.pot);
      assert.equal(calls.length, expected.length, `${type}: ${calls.length} calls`);
      expected.forEach((want, i) => {
        assert.equal(
          calls[i]!.to.toLowerCase(),
          want.to.toLowerCase(),
          `${type}: call ${i} target`,
        );
        assert.equal(calls[i]!.data, want.data.toLowerCase(), `${type}: call ${i} calldata`);
        assert.equal(calls[i]!.value, want.value ?? 0n, `${type}: call ${i} value`);
      });
    });
  }

  it("DODO's default version calls the proxy's V2 entry point", async () => {
    const { version: _, ...v2 } = SAMPLES.dodoSwap;
    const calls = recordedCalls(await env.cook(compiled(v2)), RECORDERS);
    assert.equal(
      calls[0]!.data,
      call(
        "function dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)",
        "dodoSwapV2TokenToToken",
        [A, B, AMOUNT, MIN, [T], 0n, false, DEADLINE],
      ).toLowerCase(),
    );
  });

  it("a saved output is delivered to the Pot, and read as a balance delta where the return is not an amount", async () => {
    const saved = (type: ActionType): Uint8Array =>
      compiled({ ...SAMPLES[type], saveOutputAs: "out" } as Action);

    // A captured return: the router pays the Pot, and nothing else is called.
    const v3 = recordedCalls(await env.cook(saved("uniswapV3ExactInput")), RECORDERS);
    assert.equal(v3.length, 1);
    assert.equal(
      v3[0]!.data,
      call(
        "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        "exactInputSingle",
        [[A, B, 500, env.pot, AMOUNT, MIN, 0n]],
      ).toLowerCase(),
    );

    // A balance delta: the swap pays the Pot, between two (unrecorded) balance reads.
    const v2 = recordedCalls(await env.cook(saved("uniswapV2Swap")), RECORDERS);
    assert.equal(v2.length, 1);
    assert.equal(
      v2[0]!.data,
      call(
        "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
        "swapExactTokensForTokens",
        [AMOUNT, MIN, [A, B], env.pot, DEADLINE],
      ).toLowerCase(),
    );

    // V4's TAKE pays the Pot.
    const v4 = recordedCalls(await env.cook(saved("uniswapV4ExactInput")), RECORDERS);
    assert.equal(v4.length, 2); // transfer, execute
    assert.ok(v4[1]!.data.includes(env.pot.slice(2).toLowerCase()));
  });

  it("curveSwap forwards the balance the swap delivered: post minus pre, not a constant", async () => {
    await env.testClient.setCode({ address: T as Address, bytecode: PAYING_POOL });
    await env.testClient.setBalance({ address: T as Address, value: 10n ** 18n });
    await env.testClient.setCode({ address: B as Address, bytecode: NATIVE_BALANCE_TOKEN });
    try {
      const pre = await env.publicClient.getBalance({ address: env.pot });
      const receipt = await env.cook(compiled(SAMPLES.curveSwap));
      assert.equal(receipt.status, "success", "curveSwap reverted");
      const post = await env.publicClient.getBalance({ address: env.pot });

      assert.equal(post - pre, DELIVERED);
      assert.deepEqual(
        recordedCalls(receipt, RECORDERS).map((c) => [c.to.toLowerCase(), c.data]),
        [
          [
            T.toLowerCase(),
            call("function exchange(int128,int128,uint256,uint256)", "exchange", [
              1n,
              2n,
              AMOUNT,
              MIN,
            ]).toLowerCase(),
          ],
          [
            B.toLowerCase(),
            call("function transfer(address,uint256)", "transfer", [R, post - pre]).toLowerCase(),
          ],
        ],
      );
    } finally {
      await record();
    }
  });

  it("an approve over a standing allowance resets it to zero first", async () => {
    await record({ [toFunctionSelector("allowance(address,address)")]: pad("0x05") });
    try {
      const calls = recordedCalls(await env.cook(compiled(SAMPLES.approve)), RECORDERS);
      assert.deepEqual(
        calls.map((c) => c.data),
        [0n, AMOUNT].map((amount) =>
          call("function approve(address,uint256)", "approve", [T, amount]).toLowerCase(),
        ),
      );
    } finally {
      await record();
    }
  });

  it("a write whose returndata is not `true` reverts", async () => {
    await env.testClient.setCode({ address: A as Address, bytecode: recorderCode(pad("0x00")) });
    try {
      const receipt = await env.cook(compiled(SAMPLES.transfer));
      assert.equal(receipt.status, "reverted");
    } finally {
      await record();
    }
  });

  it('a "self" recipient is the Pot', async () => {
    const receipt = await env.cook(
      compiled({ type: "transfer", amount: "5", token: A, recipient: "self" }),
    );
    assert.equal(
      recordedCalls(receipt, [A as Address])[0]!.data,
      call("function transfer(address,uint256)", "transfer", [env.pot, 5n]).toLowerCase(),
    );
  });
});

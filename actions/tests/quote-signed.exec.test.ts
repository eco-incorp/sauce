/**
 * The signed values a quote's on-chain form (`toSauce`, `toSauceDynamic`, which the split swap
 * runs) reads and writes, EXECUTED through the released engine and a real Pot against stand-in
 * contracts — no mainnet state, so every sign and boundary is chosen here.
 *
 *   - Uniswap V4's runtime quote hands the quote Router a NEGATIVE `int256 amountSpecified` (exact
 *     input), built from a run-time unsigned amount. The calldata the program sends is held, byte
 *     for byte, to the host's own viem encoding of the same quote.
 *   - Ambient's `(int128 baseFlow, int128 quoteFlow, uint128)` is read signed: the output is the
 *     magnitude of the negative flow, whichever flow it is, and no negative flow is no output.
 *
 * It runs in `test:unit`; it skips locally without the engine artifact and fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  concat,
  encodeAbiParameters,
  numberToHex,
  pad,
  toFunctionSelector,
  type Address,
} from "viem";

import { compileEvm } from "../src/compile.js";
import { fn, newEmitter, type Fragment } from "../src/emit.js";
import { quoteCall } from "../src/to-quote.js";
import { recordedCalls, recorderCode, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { SAMPLES } from "./samples.js";

const skip = skipReason();

/** The quote service and Ambient's CrocImpact: contracts whose answers the tests choose. */
const ROUTER: Address = "0x4000000000000000000000000000000000000001";
const IMPACT: Address = "0x4000000000000000000000000000000000000002";

/** What the quote Router answers: `SwapQuoteResult (amountIn, amountOut, sqrtPriceAfter, gasEstimate)`. */
const AMOUNT_OUT = 777n;
const ROUTER_ANSWER = concat([0n, AMOUNT_OUT, 0n, 0n].map((word) => pad(numberToHex(word))));

const V4 = SAMPLES.uniswapV4Swap;
const AMBIENT = SAMPLES.ambientSwap;

/** The amount, read from the Pot while the program runs: a run-time value, never folded in. */
const AMOUNT = "ctx.balance(ctx.self())";

const INT128_MIN = -(1n << 127n);

describe("a quote's on-chain form, signed, executed", { skip, timeout: 120_000 }, () => {
  let env: Anvil;

  before(async () => {
    env = await startAnvil();
    await env.testClient.setCode({ address: ROUTER, bytecode: recorderCode(ROUTER_ANSWER) });
  });

  after(() => env?.stop());

  /** `main(): Uint256 { <fragment>; return <expression>; }`, compiled as a split compiles it. */
  const program = (fragment: Fragment): Uint8Array =>
    compileEvm(fn("main", [], "Uint256", [...fragment.stmts, `return ${fragment.expr};`])).bytecode;

  describe("Uniswap V4: amountSpecified is the negated run-time amount", () => {
    const quoteProgram = (): Uint8Array => {
      const { toSauceDynamic } = quoteCall(V4, 1n, { router: ROUTER });
      assert.ok(toSauceDynamic);
      return program(toSauceDynamic(newEmitter(), AMOUNT));
    };

    for (const amount of [1n, 12_345n, 10n ** 18n, (1n << 255n) - 1n]) {
      it(`${amount}: the Router is called with the host's own encoding of -${amount}`, async () => {
        await env.testClient.setBalance({ address: env.pot, value: amount });
        const bytecode = quoteProgram();

        const receipt = await env.cook(bytecode);
        assert.equal(receipt.status, "success", "the quote program reverted");
        const calls = recordedCalls(receipt, [ROUTER]);
        assert.equal(calls.length, 1);
        const expected = quoteCall(V4, amount, { router: ROUTER }).data;
        assert.equal(calls[0]!.data, expected.toLowerCase());
        // The sign itself: the word is -amount in two's complement, not amount, and not a wrap of it.
        const word = pad(numberToHex(BigInt.asUintN(256, -amount)));
        assert.ok(calls[0]!.data.includes(word.slice(2)), "amountSpecified is not -amount");
        // And main returns the quote's output, the second word of its answer.
        assert.equal(BigInt(await env.returned(bytecode)), AMOUNT_OUT);
      });
    }

    for (const amount of [1n << 255n, (1n << 256n) - 1n]) {
      it(`${amount}: no int256 can carry the negation, so the program reverts before the Router is called`, async () => {
        await env.testClient.setBalance({ address: env.pot, value: amount });
        const receipt = await env.cook(quoteProgram());
        assert.equal(receipt.status, "reverted");
        assert.equal(recordedCalls(receipt, [ROUTER]).length, 0);
      });
    }

    it("a zero amount is a zero amountSpecified, not a revert", async () => {
      await env.testClient.setBalance({ address: env.pot, value: 0n });
      const receipt = await env.cook(quoteProgram());
      assert.equal(receipt.status, "success");
      assert.equal(
        recordedCalls(receipt, [ROUTER])[0]!.data,
        quoteCall(V4, 0n, { router: ROUTER }).data.toLowerCase(),
      );
    });
  });

  describe("Ambient: the output is the magnitude of the negative flow", () => {
    const CALC_IMPACT = toFunctionSelector(
      "calcImpact(address,address,uint256,bool,bool,uint128,uint16,uint128)",
    );
    const FINAL_PRICE = 1n << 64n;
    /** (baseFlow, quoteFlow), sign-extended as an int128 return is, and what each must quote. */
    const flows: ReadonlyArray<readonly [string, bigint, bigint, bigint]> = [
      ["the base flow is the negative one", -500n, 300n, 500n],
      ["the quote flow is the negative one", 300n, -700n, 700n],
      ["a one-unit output", -1n, 0n, 1n],
      ["a one-unit output in the quote flow", 0n, -1n, 1n],
      ["int128's minimum, as the base flow", INT128_MIN, 1n, 1n << 127n],
      ["int128's minimum, as the quote flow", 1n, INT128_MIN, 1n << 127n],
      ["a large output", -(10n ** 30n), 10n ** 30n, 10n ** 30n],
      ["no negative flow is no output", 5n, 5n, 0n],
      ["both flows zero is no output", 0n, 0n, 0n],
    ];

    for (const [name, base, quote, output] of flows) {
      it(`${name}: ${output}`, async () => {
        const answer = encodeAbiParameters(
          [{ type: "int128" }, { type: "int128" }, { type: "uint128" }],
          [base, quote, FINAL_PRICE],
        );
        await env.testClient.setCode({
          address: IMPACT,
          bytecode: recorderCode(answer, { [CALC_IMPACT]: answer }),
        });
        await env.testClient.setBalance({ address: env.pot, value: 10n ** 18n });
        const { decode, toSauce, toSauceDynamic } = quoteCall(AMBIENT, 10n ** 18n, {
          ambientImpact: IMPACT,
        });
        assert.ok(toSauce && toSauceDynamic);
        // The host decodes the same answer to the same output: the two forms agree.
        assert.equal(decode(answer), output);

        const fixed = BigInt(await env.returned(program(toSauce(newEmitter()))));
        const dynamic = BigInt(await env.returned(program(toSauceDynamic(newEmitter(), AMOUNT))));
        assert.equal(fixed, output, "toSauce");
        assert.equal(dynamic, output, "toSauceDynamic");
      });
    }
  });
});

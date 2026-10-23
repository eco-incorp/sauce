/**
 * What the kit reads back from a program, with no chain: `main`'s return decoded as it declares it,
 * and a revert's reason from its data or from the error viem throws.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BaseError,
  concat,
  encodeAbiParameters,
  numberToHex,
  padHex,
  RpcRequestError,
  stringToHex,
  type Hex,
} from "viem";

import { compileProgram, reasonOf, revertOf } from "../../src/testing/program.js";
import { requireChain } from "../../src/testing/sdk.js";

const base = requireChain("base");
const word = (value: bigint | number | boolean): Hex =>
  numberToHex(typeof value === "boolean" ? (value ? 1n : 0n) : BigInt(value), { size: 32 });
/** `main` declaring `returnType`; only its declaration matters to `decode`. */
const returning = (returnType: string, body: string) =>
  compileProgram({ source: `function main(): ${returnType} {\n  return ${body};\n}\n` }, base);

describe("decode", () => {
  it("keeps a returned string a string, digits and leading zeroes included", () => {
    const program = returning("string", '"123"');
    assert.equal(program.decode(stringToHex("123")), "123");
    assert.equal(program.decode(stringToHex("007")), "007");
    assert.equal(program.decode(stringToHex("")), "");
  });

  it("reads integers as bigints, wherever the type has them", () => {
    assert.equal(returning("Uint256", "7").decode(word(7)), 7n);

    const array = returning("Uint256[]", "[1, 2]");
    assert.deepEqual(array.decode(concat([word(1), word(2)])), [1n, 2n]);

    const self = "0x00000000000000000000000000000000000000AA";
    const record = returning(
      "{ amount: Uint256; to: Address; ok: bool }",
      "{ amount: 7, to: ctx.self(), ok: true }",
    );
    assert.deepEqual(record.decode(concat([word(7), padHex(self, { size: 32 }), word(true)])), {
      amount: 7n,
      to: "0x00000000000000000000000000000000000000AA",
      ok: true,
    });
  });
});

/** A called contract's `Error(string)` and `Panic(uint256)`, as the cook reverts with them. */
const errorString = (message: string): Hex =>
  concat(["0x08c379a0", encodeAbiParameters([{ type: "string" }], [message])]);
const panic = (code: bigint): Hex =>
  concat(["0x4e487b71", encodeAbiParameters([{ type: "uint256" }], [code])]);

describe("reasonOf", () => {
  it("reads a called contract's Error(string) and Panic(uint256)", () => {
    assert.equal(reasonOf(errorString("STF")), "STF");
    assert.equal(reasonOf(errorString("")), "");
    assert.equal(reasonOf(panic(0x11n)), "panic 0x11");
    assert.equal(reasonOf(panic(1n)), "panic 0x1");
  });

  it("reads a program's own message as its text", () => {
    assert.equal(reasonOf(stringToHex("product above limit")), "product above limit");
    assert.equal(reasonOf(stringToHex("prix trop élevé")), "prix trop élevé");
    assert.equal(reasonOf(stringToHex("line one\n\tline two\r\n")), "line one\n\tline two\r\n");
  });

  it("reads nothing from data that is neither", () => {
    assert.equal(reasonOf(undefined), undefined);
    assert.equal(reasonOf("0x"), undefined);
    // A control character, a DEL, a lone NUL: bytes, not a message.
    assert.equal(reasonOf(stringToHex("ok\u0001")), undefined);
    assert.equal(reasonOf(stringToHex("ok\u007f")), undefined);
    assert.equal(reasonOf("0x00"), undefined);
    // Not UTF-8, and a custom error's selector and argument.
    assert.equal(reasonOf("0xff"), undefined);
    assert.equal(reasonOf(concat(["0xdeadbeef", numberToHex(1n, { size: 32 })])), undefined);
  });
});

describe("revertOf", () => {
  it("finds the revert data on whichever cause carries it", () => {
    const data = stringToHex("product above limit");
    const carrier = Object.assign(new BaseError("the node's error"), { data });
    const error = new BaseError("the call failed", {
      cause: new BaseError("the request failed", { cause: carrier }),
    });
    const reverted = revertOf(error);
    assert.equal(reverted.data, data);
    assert.equal(reverted.reason, "product above limit");
    assert.equal(reverted.cause, error);
  });

  it("finds it under a JSON-RPC error's own data, or as viem's RpcRequestError keeps it", () => {
    const data = panic(0x12n);
    const nested = new BaseError("the call failed", {
      cause: Object.assign(new Error("execution reverted"), {
        data: { message: "execution reverted", data },
      }),
    });
    assert.deepEqual([revertOf(nested).data, revertOf(nested).reason], [data, "panic 0x12"]);

    const request = new BaseError("the call failed", {
      cause: new RpcRequestError({
        body: {},
        error: { code: 3, message: "execution reverted", data: errorString("STF") },
        url: "http://127.0.0.1:8545",
      }),
    });
    assert.deepEqual(
      [revertOf(request).data, revertOf(request).reason],
      [errorString("STF"), "STF"],
    );
  });

  it("takes the reason from the node's wording when no data carries one", () => {
    const details = revertOf(
      new BaseError("Execution reverted", {
        details: "execution reverted: amountIn is not in the Pot",
      }),
    );
    assert.deepEqual([details.data, details.reason], [undefined, "amountIn is not in the Pot"]);

    const short = revertOf(new BaseError("Execution reverted with reason: too late."));
    assert.deepEqual([short.data, short.reason], [undefined, "too late"]);

    // Data it cannot read (a custom error) is kept; the node's wording, which viem keeps as the
    // details, gives the reason.
    const custom = concat(["0xdeadbeef", numberToHex(1n, { size: 32 })]);
    const both = revertOf(
      new BaseError("Execution reverted", {
        cause: Object.assign(new Error("execution reverted: Expired()"), { data: custom }),
      }),
    );
    assert.deepEqual([both.data, both.reason], [custom, "Expired()"]);
  });

  it("keeps an error that is not viem's as the cause, with no reason or data", () => {
    const error = new Error("socket hang up");
    const reverted = revertOf(error);
    assert.deepEqual(
      [reverted.data, reverted.reason, reverted.cause],
      [undefined, undefined, error],
    );
  });
});

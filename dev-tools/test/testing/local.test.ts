/**
 * `local()`: an empty chain with the released stack deployed at its release addresses. Runs
 * wherever anvil does; skips without it locally, and fails under CI, where it must run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { concat, encodeAbiParameters, numberToHex, size, toHex, type Hex } from "viem";

import { CookReverted, local, type TestChain } from "../../src/testing/index.js";
import { rpc } from "../../src/testing/node.js";
import { anvilMissing, program } from "./support.js";

describe("local()", { skip: anvilMissing() }, () => {
  let chain: TestChain;
  before(async () => {
    chain = await local();
  });
  after(() => chain?.stop());

  it("runs as Base with the stack deployed and account 0's Pot ready", async () => {
    assert.equal(chain.chain.slug, "base");
    assert.equal(chain.mode, "local");
    assert.equal(chain.stack.origin, "deployed");
    assert.equal(await chain.executionFee(), 0n);
    assert.notEqual(await chain.client.getCode({ address: chain.account(0).pot }), undefined);
  });

  it("runs a program and decodes what main returns", async () => {
    const result = await chain.run(program("multiply"), { args: [6n, 7n, 100n] });
    assert.equal(result.returned, 42n);
    assert.ok(result.hash);
    assert.ok(result.gasUsed > 0n);
  });

  it("simulates without sending", async () => {
    const before = await chain.client.getBlockNumber();
    const result = await chain.simulate(program("multiply"), { args: [3n, 5n, 100n] });
    assert.equal(result.returned, 15n);
    assert.equal(await chain.client.getBlockNumber(), before);
  });

  it("throws CookReverted with require's message", async () => {
    await assert.rejects(
      chain.run(program("multiply"), { args: [20n, 20n, 100n] }),
      (error: unknown) => error instanceof CookReverted && error.reason === "product above limit",
    );
    await assert.rejects(
      chain.simulate(program("multiply"), { args: [20n, 20n, 100n] }),
      (error: unknown) => error instanceof CookReverted && error.reason === "product above limit",
    );
  });

  it("throws CookReverted with a called contract's Error(string) or Panic(uint256)", async () => {
    // Runtime code that reverts with `payload`: copy it to memory, revert with it.
    const reverting = (payload: Hex): Hex => {
      const length = numberToHex(size(payload), { size: 1 }).slice(2);
      return `0x60${length}600c60003960${length}6000fd${payload.slice(2)}`;
    };
    const source =
      "function main(target: Address): Uint256 {\n  evm.call(target, 0, hex`00`);\n  return 1;\n}\n";
    const cases: ReadonlyArray<readonly [Hex, Hex, string]> = [
      [
        "0x00000000000000000000000000000000000000e1",
        concat(["0x08c379a0", encodeAbiParameters([{ type: "string" }], ["STF"])]),
        "STF",
      ],
      [
        "0x00000000000000000000000000000000000000e2",
        concat(["0x4e487b71", encodeAbiParameters([{ type: "uint256" }], [0x11n])]),
        "panic 0x11",
      ],
    ];
    for (const [target, payload, reason] of cases) {
      await chain.test.setCode({ address: target, bytecode: reverting(payload) });
      for (const cook of [chain.run, chain.simulate]) {
        await assert.rejects(
          cook.call(chain, { source }, { args: [target] }),
          (error: unknown) =>
            error instanceof CookReverted && error.reason === reason && error.data === payload,
        );
      }
    }
  });

  it("returns what the mined transaction returned", async () => {
    const result = await chain.run({
      source:
        "function main(): Uint256 {\n  evm.sstore(1234, ctx.blockNumber());\n  return ctx.blockNumber();\n}\n",
    });
    const { blockNumber } = await chain.client.getTransactionReceipt({ hash: result.hash! });
    const stored = await chain.client.getStorageAt({
      address: chain.account(0).pot,
      slot: toHex(1234, { size: 32 }),
    });
    assert.equal(BigInt(stored!), blockNumber);
    assert.equal(result.returned, blockNumber);
  });

  it("sends a cook whatever a rehearsal in the block before says, and reports the mined one", async () => {
    const source =
      'function main(n: Uint256): Uint256 {\n  require(ctx.blockNumber() == n, "not this block");\n  return n;\n}\n';
    // Valid only in the block it is mined in: a rehearsal on the latest block refuses it.
    const next = (await chain.client.getBlockNumber()) + 1n;
    assert.equal((await chain.run({ source }, { args: [next] })).returned, next);

    // Valid only in the latest block: the mined transaction reverts, with its own reason.
    const latest = await chain.client.getBlockNumber();
    await assert.rejects(
      chain.run({ source }, { args: [latest] }),
      (error: unknown) => error instanceof CookReverted && error.reason === "not this block",
    );
  });

  it("cooks from another account's Pot, deploying it first", async () => {
    const other = chain.account(3);
    assert.equal(await chain.client.getCode({ address: other.pot }), undefined);
    const result = await chain.run(program("multiply"), { from: 3, args: [2n, 2n, 10n] });
    assert.equal(result.returned, 4n);
    assert.notEqual(await chain.client.getCode({ address: other.pot }), undefined);
  });

  it("compiles source text as well as files", async () => {
    const result = await chain.simulate({
      source: "function main(): Uint256 {\n  return chainId;\n}\n",
    });
    assert.equal(result.returned, 8453n);
  });

  it("returns a string as the string main returned", async () => {
    for (const text of ["123", "007"]) {
      const result = await chain.run({
        source: `function main(): string {\n  return "${text}";\n}\n`,
      });
      assert.equal(result.returned, text);
    }
  });

  it("runs a program's imports as they are now, not as they were first compiled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-imports-"));
    const answer = (value: number) =>
      `export function answer(): Uint256 {\n  return ${value};\n}\n`;
    const source =
      'import { answer } from "./helper.js";\nfunction main(): Uint256 {\n  return answer();\n}\n';
    try {
      const file = join(dir, "main.sauce.ts");
      writeFileSync(file, source);
      writeFileSync(join(dir, "helper.js"), answer(1));
      assert.equal((await chain.run(file)).returned, 1n);
      // The program's own text is unchanged; what it imports is not.
      writeFileSync(join(dir, "helper.js"), answer(2));
      assert.equal((await chain.run(file)).returned, 2n);

      // The same text beside another helper is another program.
      for (const value of [3, 4]) {
        mkdirSync(join(dir, String(value)));
        writeFileSync(join(dir, String(value), "helper.js"), answer(value));
        const path = join(dir, String(value), "main.sauce.ts");
        assert.equal((await chain.simulate({ source, path })).returned, BigInt(value));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to fund a token whose balance it cannot write, and writes nothing", async () => {
    const holder = chain.account(1).address;
    // A token whose balanceOf answers 5 to anyone: computed, held in no storage slot.
    const computed = "0x00000000000000000000000000000000000000e3";
    await chain.test.setCode({ address: computed, bytecode: "0x600560005260206000f3" });
    await assert.rejects(
      chain.fund(holder, { [computed]: 1n }),
      /cannot fund .* with 0x0+e3: no storage slot of .* holds the balance/i,
    );
    assert.equal(await chain.balanceOf(holder, computed), 5n);

    // A B20 token: a precompile of the Base node, whose account holds the one byte 0xef.
    const b20 = "0x00000000000000000000000000000000000000e4";
    await chain.test.setCode({ address: b20, bytecode: "0xef" });
    await assert.rejects(chain.fund(holder, { [b20]: 1n }), /cannot fund .* is a B20 token/i);
  });

  it("impersonates an address only while its body runs, topping up one with too little", async () => {
    const stranger = "0x00000000000000000000000000000000000000f2";
    const recipient = "0x00000000000000000000000000000000000000f3";
    // Not a dev account: the node sends for it only while it is impersonated.
    const unsigned = () =>
      rpc(chain.rpcUrl, "eth_sendTransaction", [{ from: stranger, to: recipient, value: "0x1" }]);
    await assert.rejects(unsigned());

    const hash = await chain.impersonate(stranger, async (send) => {
      // It held nothing: given 1 ETH for its gas.
      assert.equal(await chain.balanceOf(stranger, "ETH"), 10n ** 18n);
      return send({ to: recipient, value: 1n });
    });
    const receipt = await chain.client.getTransactionReceipt({ hash });
    assert.equal(receipt.from.toLowerCase(), stranger);
    assert.equal(await chain.balanceOf(recipient, "ETH"), 1n);
    await assert.rejects(unsigned());

    // One that holds enough keeps what it holds; a send that reverts throws, and still ends it.
    await chain.fund(stranger, { ETH: "5" });
    const holding = await chain.balanceOf(stranger, "ETH");
    const refuses = "0x00000000000000000000000000000000000000f4";
    await chain.test.setCode({ address: refuses, bytecode: "0x60006000fd" });
    await assert.rejects(
      chain.impersonate(stranger, async (send) => {
        assert.equal(await chain.balanceOf(stranger, "ETH"), holding);
        await send({ to: refuses });
      }),
      /reverted/,
    );
    await assert.rejects(unsigned());
  });

  it("funds the native currency, snapshots and reverts, and moves time", async () => {
    const pot = chain.account(0).pot;
    await chain.snapshot();
    await chain.fund(pot, { ETH: "1.5" });
    assert.equal(await chain.balanceOf(pot, "ETH"), 1_500_000_000_000_000_000n);
    await chain.revert();
    assert.equal(await chain.balanceOf(pot, "ETH"), 0n);

    const now = await chain.now();
    await chain.increaseTime(3_600);
    assert.ok((await chain.now()) >= now + 3_600n);
  });
});

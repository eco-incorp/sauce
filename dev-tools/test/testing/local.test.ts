/**
 * `local()`: an empty chain with the released stack deployed at its release addresses. Runs
 * wherever anvil does; skips without it locally, and fails under CI, where it must run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { CookReverted, local, type TestChain } from "../../src/testing/index.js";
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

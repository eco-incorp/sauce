/**
 * `local({ chain: "solana" })`: an empty Solana chain in LiteSVM with the released engine and
 * Kitchen. Runs wherever the packaged engine binaries and LiteSVM are; skips without them locally,
 * and fails under CI, where it must run.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { address, type Address } from "@solana/kit";

import {
  CookReverted,
  fork,
  local,
  type SolanaChange,
  type SolanaTestChain,
} from "../../src/testing/index.js";
import { deriveCodeBufferPda } from "../../src/testing/sdk.js";
import { program } from "./support.js";
import { solanaMissing } from "./solana-support.js";

/** A program of `steps` arithmetic steps on `a`: past one transaction's 1,232 bytes. */
function large(steps: number): { source: string; expected: (a: bigint) => bigint } {
  let body = "  let x = a;\n";
  for (let i = 0; i < steps; i++) body += `  x = (x * ${i + 3} + ${i + 1}) % 1000003;\n`;

  return {
    source: `function main(a: Uint256): Uint256 {\n${body}  return x;\n}\n`,
    expected: (a) => {
      let x = a;
      for (let i = 0; i < steps; i++) x = (x * BigInt(i + 3) + BigInt(i + 1)) % 1000003n;
      return x;
    },
  };
}

describe('local({ chain: "solana" })', { skip: solanaMissing() }, () => {
  let chain: SolanaTestChain;
  before(async () => {
    chain = await local({ chain: "solana" });
  });
  after(() => chain?.stop());

  it("runs as Solana with the release's programs, no fee, and account 0's Pot created", async () => {
    assert.equal(chain.chain.slug, "solana");
    assert.equal(chain.mode, "local");
    assert.equal(await chain.executionFee(), 0n);
    const pot = await chain.getAccount(chain.account(0).pot);
    assert.equal(pot?.owner, chain.engine);
    assert.equal(await chain.slot(), 1_000n);
    // Each test account holds 1,000 SOL, and its keypair is solana-keygen's 64 bytes.
    const alice = chain.account(0);
    assert.equal(alice.secretKey.length, 64);
    assert.equal(await chain.balanceOf(chain.account(9).address, "SOL"), 1_000n * 10n ** 9n);
    assert.throws(() => chain.account(10), RangeError);
  });

  it("runs a program and decodes what main returns", async () => {
    const result = await chain.run(program("multiply"), { args: [6n, 7n, 100n] });
    assert.equal(result.returned, 42n);
    assert.ok(result.signature);
    assert.ok(result.computeUnits > 0n);
    assert.equal(result.staged, false);
    // It moved nothing but the transaction's fee, which the owner paid.
    const changes: readonly SolanaChange[] = result.changes;
    assert.deepEqual(changes, [
      { holder: chain.account(0).address, token: "SOL", amount: -5_000n },
    ]);
    assert.equal(result.delta(chain.account(0).address, "SOL"), -5_000n);
  });

  it("throws CookReverted with require's message, its bytes and the logs", async () => {
    for (const cook of [chain.run, chain.simulate]) {
      await assert.rejects(
        cook.call(chain, program("multiply"), { args: [20n, 20n, 100n] }),
        (error: unknown) =>
          error instanceof CookReverted &&
          error.reason === "product above limit" &&
          error.data === "0x70726f647563742061626f7665206c696d6974" &&
          error.logs!.some((line) => line.includes(" failed: custom program error: 0x0")),
      );
    }
  });

  it("says why the engine refused a program", async () => {
    await assert.rejects(
      chain.run(
        { source: "function main(a: Uint256): Uint256 {\n  return a * a;\n}\n" },
        { args: [2n ** 200n] },
      ),
      (error: unknown) =>
        error instanceof CookReverted &&
        error.reason === "the engine refused: Overflow (custom program error 51)" &&
        error.data === undefined,
    );
  });

  it("stages a program too large for one transaction, and closes its code buffer", async () => {
    const { source, expected } = large(300);
    assert.ok((chain.compile({ source }).bytecode.length - 2) / 2 > 1_232);
    const result = await chain.run({ source }, { args: [7n] });
    assert.equal(result.staged, true);
    assert.equal(result.returned, expected(7n));
    const owner = chain.account(0).address;
    const { address: buffer } = await deriveCodeBufferPda(chain.kitchen, owner, 0n);
    assert.equal(await chain.getAccount(buffer), null);
    // Simulated, the same: staged, and the buffer gone with everything else.
    assert.equal((await chain.simulate({ source }, { args: [8n] })).returned, expected(8n));
    assert.equal(await chain.getAccount(buffer), null);
  });

  it("moves wrapped SOL with the token methods, creating the recipient's account first", async () => {
    const pot = chain.account(0).pot;
    const to = chain.account(2).address;
    await chain.fund(pot, { WSOL: "1" });
    assert.equal(await chain.balanceOf(pot, "WSOL"), 10n ** 9n);
    const source =
      "function main(to: Address, amount: Uint256) {\n  WSOL.transfer(to, amount);\n}\n";
    const result = await chain.run({ source }, { args: [to, 1_000n] });
    assert.equal(result.returned, undefined);
    assert.equal(result.delta(to, "WSOL"), 1_000n);
    assert.equal(result.delta(pot, "WSOL"), -1_000n);
    assert.equal(result.delta(to, address("So11111111111111111111111111111111111111112")), 1_000n);
    assert.equal(await chain.balanceOf(to, "WSOL"), 1_000n);
  });

  it("simulates without keeping anything", async () => {
    const pot = chain.account(0).pot;
    const to = chain.account(4).address;
    const held = await chain.balanceOf(pot, "WSOL");
    const source =
      "function main(to: Address, amount: Uint256) {\n  WSOL.transfer(to, amount);\n}\n";
    const result = await chain.simulate({ source }, { args: [to, 500n] });
    assert.equal(result.signature, undefined);
    assert.equal(result.delta(to, "WSOL"), 500n);
    // Neither the payment nor the recipient's account it created stayed.
    assert.equal(await chain.balanceOf(pot, "WSOL"), held);
    assert.equal(await chain.balanceOf(to, "WSOL"), 0n);
  });

  it("cooks from another account's Pot, creating it first", async () => {
    const other = chain.account(3);
    assert.equal(await chain.getAccount(other.pot), null);
    const result = await chain.run(program("multiply"), { from: 3, args: [2n, 2n, 10n] });
    assert.equal(result.returned, 4n);
    assert.equal((await chain.getAccount(other.pot))?.owner, chain.engine);
  });

  it("asks for the accounts nothing derives, and refuses one the program does not take", async () => {
    const source =
      "function main(destination: Account<Writable>, amount: Uint256): Uint256 {\n" +
      "  return amount;\n}\n";
    await assert.rejects(
      chain.run({ source }, { args: [1n] }),
      /the cook needs destination \(writable\): name each in `accounts`/,
    );
    await assert.rejects(
      chain.run({ source }, { args: [1n], accounts: { destination: "pot", nope: "owner" } }),
      /accounts\.nope: the program has no account by that name; it takes destination/,
    );
    const result = await chain.run(
      { source },
      { args: [5n], accounts: { destination: `${chain.account(5).address}:WSOL` } },
    );
    assert.equal(result.returned, 5n);
  });

  it("derives an account from main's Int256 argument, as from a Uint256 one", async () => {
    const source = "function main(seeded: Account, n: Int256): Int256 {\n  return n;\n}\n";
    const accounts = { seeded: `pda:${chain.kitchen}:u64:@n` };
    assert.equal((await chain.run({ source }, { args: [300n], accounts })).returned, 300n);
  });

  it("is Solana by any of its names, and takes no block", async () => {
    const other = await local({ chain: 1399811149 });
    assert.equal(other.chain.slug, "solana");
    await other.stop();
    await assert.rejects(
      fork("mainnet-beta" as string, { block: 1, rpcUrl: "http://127.0.0.1:1" }),
      /a Solana fork takes no `block`/,
    );
  });

  it("refuses a token an empty chain does not have", async () => {
    await assert.rejects(
      chain.fund(chain.account(0).pot, { USDC: "1" }),
      /USDC's mint, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, is not on this chain: an empty local chain has no tokens but wrapped SOL, so fork one/,
    );
    await assert.rejects(chain.balanceOf(chain.account(0).pot, "NOPE"), /NOPE is not a token/);
  });

  it("funds SOL, snapshots and reverts, and moves the clock a program reads", async () => {
    const holder = chain.account(6).address;
    const before = await chain.balanceOf(holder, "SOL");
    await chain.snapshot();
    await chain.fund(holder, { SOL: "1.5" });
    assert.equal(await chain.balanceOf(holder, "SOL"), before + 1_500_000_000n);
    const key: Address = address("Fu11111111111111111111111111111111111111111");
    await chain.setAccount(key, {
      lamports: 1_000_000n,
      owner: address("11111111111111111111111111111111"),
      data: new Uint8Array([1, 2, 3]),
      executable: false,
    });
    assert.deepEqual((await chain.getAccount(key))?.data, new Uint8Array([1, 2, 3]));
    // The chain's own accounts too: the native mint an empty chain starts with.
    const native = address("So11111111111111111111111111111111111111112");
    const mint = (await chain.getAccount(native))!;
    await chain.setAccount(native, { ...mint, lamports: mint.lamports + 1n });
    await assert.rejects(
      chain.setAccount(chain.engine, null),
      /is a program: the kit changes none/,
    );
    await chain.revert();
    assert.equal(await chain.balanceOf(holder, "SOL"), before);
    assert.equal(await chain.getAccount(key), null);
    assert.equal((await chain.getAccount(native))?.lamports, mint.lamports);
    await assert.rejects(chain.revert(), /revert\(\) with no snapshot\(\) to return to/);

    const clock = {
      source:
        "function main(): { slot: Uint256; time: Uint256 } {\n" +
        "  return { slot: ctx.blockNumber(), time: ctx.timestamp() };\n}\n",
    };
    const slot = await chain.slot();
    const now = await chain.now();
    assert.deepEqual((await chain.simulate(clock)).returned, { slot, time: now });
    await chain.increaseTime(3_600);
    assert.equal(await chain.now(), now + 3_600n);
    assert.equal(await chain.slot(), slot + 9_000n);
    await chain.warp(10);
    assert.deepEqual((await chain.simulate(clock)).returned, {
      slot: slot + 9_010n,
      time: now + 3_604n,
    });
  });
});

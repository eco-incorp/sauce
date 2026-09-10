/**
 * Code-buffer lifecycle against the released `kitchen.so`.
 *
 * A file of its own so it builds ONE LiteSVM: two in a process — each loading the kitchen AND the
 * engine — is the shape the intermittent teardown abort followed, and the suites with one never
 * hit it. Pot lifecycle is `kitchen.e2e.test.ts`, the cooks are `kitchen-cook.e2e.test.ts`.
 */
import { createHash } from "node:crypto";
import {
  buildCloseCodeBufferInstruction,
  buildCreateCodeBufferInstruction,
  buildFinalizeCodeBufferInstruction,
  buildWriteCodeBufferInstruction,
  deriveCodeBufferPda,
  deriveCodePda,
} from "../../src/svm/kitchen.js";
import {
  type Bench,
  describeKitchen,
  expectOk,
  present,
  send,
  start,
  traceTests,
} from "./kitchen-bench.js";

describeKitchen("kitchen: code buffer lifecycle", () => {
  traceTests();

  let bench: Bench;

  beforeAll(async () => {
    bench = await start();
  });

  // Released before jest tears the module registry down. The VM is a napi handle over a BPF runtime
  // with two loaded programs, and holding one at module scope — which no other engine suite here
  // does — is the shape the intermittent teardown abort followed.
  afterAll(() => {
    bench = undefined as unknown as Bench;
  });

  it("create → write → finalize → close round-trips a program's bytes and refunds", async () => {
    const nonce = 1n;
    const { address: codeBuffer } = await deriveCodeBufferPda(
      bench.kitchen,
      bench.owner.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(bench.kitchen, codeBuffer);
    const bytecode = new Uint8Array(128).map((_, i) => i % 251);
    const accounts = { kitchen: bench.kitchen, owner: bench.owner.address, codeBuffer, code };

    expectOk(
      await send(bench, [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: bytecode.length }),
      ]),
      "create_code_buffer",
    );
    expectOk(
      await send(bench, [
        buildWriteCodeBufferInstruction({ ...accounts, offset: 0, chunk: bytecode }),
      ]),
      "write_code_buffer",
    );

    const digest = new Uint8Array(createHash("sha256").update(bytecode).digest());
    expectOk(
      await send(bench, [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: bytecode.length,
          expectedSha256: digest,
        }),
      ]),
      "finalize_code_buffer",
    );

    // finalize SHRINKS the code account to exactly `len` — that is the security property, since the
    // engine executes the whole slice and any trailing byte would be jump-reachable but unhashed.
    const staged = present(bench.svm, code, "the staged code");
    expect(staged.data.length).toBe(bytecode.length);
    expect(Array.from(staged.data)).toEqual(Array.from(bytecode));

    // The close is asserted by its REFUND, read off the owner — an account that is still there.
    //
    // Neither closed address is touched again, not even to re-create it: for the code buffer that
    // is itself what aborts the process (a Pot tolerates it, this pair does not), on top of the
    // reads that already did. So this states what the close achieved — it succeeded, and the rent
    // for both accounts came back — and leaves the account table alone.
    // BOTH rents, measured before the close. `> beforeClose` alone was satisfied by either account
    // on its own, so a close that reclaimed the metadata buffer and orphaned the `code` PDA passed.
    const beforeClose = bench.svm.getBalance(bench.owner.address) ?? 0n;
    const bufferRent = bench.svm.getBalance(codeBuffer) ?? 0n;
    const codeRent = bench.svm.getBalance(code) ?? 0n;
    expect(bufferRent).toBeGreaterThan(0n);
    expect(codeRent).toBeGreaterThan(0n);

    expectOk(
      await send(bench, [buildCloseCodeBufferInstruction({ ...accounts, expectedSha256: digest })]),
      "close_code_buffer",
    );

    // Strictly more than the LARGER rent alone, so neither account can account for it by itself.
    const gained = (bench.svm.getBalance(bench.owner.address) ?? 0n) - beforeClose;
    expect(gained).toBeGreaterThan(bufferRent > codeRent ? bufferRent : codeRent);
  });

  it("finalize refuses a digest that is not the staged bytes", async () => {
    const nonce = 2n;
    const { address: codeBuffer } = await deriveCodeBufferPda(
      bench.kitchen,
      bench.owner.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(bench.kitchen, codeBuffer);
    const bytecode = new Uint8Array(64).fill(0xab);
    const accounts = { kitchen: bench.kitchen, owner: bench.owner.address, codeBuffer, code };

    expectOk(
      await send(bench, [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: bytecode.length }),
      ]),
      "create_code_buffer",
    );
    expectOk(
      await send(bench, [
        buildWriteCodeBufferInstruction({ ...accounts, offset: 0, chunk: bytecode }),
      ]),
      "write_code_buffer",
    );

    const wrong = new Uint8Array(32).fill(1);
    const result = await send(bench, [
      buildFinalizeCodeBufferInstruction({
        ...accounts,
        len: bytecode.length,
        expectedSha256: wrong,
      }),
    ]);

    expect((result as { err?: unknown }).err).toBeTruthy();
  });

  it("distinct nonces derive distinct buffers, and each code account follows its buffer", async () => {
    const a = await deriveCodeBufferPda(bench.kitchen, bench.owner.address, 1n);
    const b = await deriveCodeBufferPda(bench.kitchen, bench.owner.address, 2n);

    expect((await deriveCodePda(bench.kitchen, a.address)).address).not.toBe(
      (await deriveCodePda(bench.kitchen, b.address)).address,
    );
  });
});

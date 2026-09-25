/**
 * The two cook TRANSPORTS, against the released `kitchen.so` CPI-ing into the released engine. Kept
 * apart from the lifecycle suite so each runs in its own process — CI's engine step is one process
 * per file — and so a failure names the transport rather than the whole kitchen. The bench they
 * share is `kitchen-bench.ts`.
 */
import { createHash } from "node:crypto";
import { AccountRole } from "@solana/kit";
import {
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildWriteCodeBufferInstruction,
  deriveCodeBufferPda,
  deriveCodePda,
  derivePotPda,
  GROWTH_STEP,
} from "../../src/svm/kitchen.js";
import {
  type Bench,
  describeKitchen,
  expectKitchenError,
  expectOk,
  present,
  send,
  sendCook,
  start,
  traceTests,
} from "./kitchen-bench.js";

/**
 * The two transports that actually EXECUTE, against the real `kitchen.so` CPI-ing into the real
 * `engine-devnet.so`. These are what the engine-per-call and unsigned-Pot-in-tail rules are for, and
 * a discriminator guard cannot reach them: a wrong account ORDER or ROLE in either builder still
 * emits the right eight bytes and fails only here.
 *
 * `[BYTE_1 42][STOP]` is the smallest program the engine will run — enough to prove the CPI lands and
 * the accounts line up, without depending on any opcode whose encoding differs between lineages.
 */
describeKitchen("kitchen: cook transports on the released engine", () => {
  traceTests();

  let bench: Bench;

  beforeAll(async () => {
    bench = await start();
  });

  // Released before jest tears the module registry down. The VM is a napi handle over a BPF runtime
  // with two loaded programs, and holding one at module scope — which no other engine suite here
  // does — is the shape the intermittent teardown abort followed.
  const PROGRAM = new Uint8Array([0x01, 0x2a, 0x00]);

  /** Creates the Pot `cook` will sign for, and hands back the tail entry it rides in — UNSIGNED. */
  const potFor = async (salt: Uint8Array) => {
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    expectOk(
      await send(bench, [
        buildCreatePotInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          pot,
          salt,
          space: 256,
        }),
      ]),
      "create_pot",
    );

    return { pot, tail: [{ address: pot, role: AccountRole.WRITABLE }] as const };
  };

  it("cook executes inline bytecode, with the Pot riding the tail unsigned", async () => {
    const salt = new Uint8Array(32).fill(21);
    const { pot, tail } = await potFor(salt);

    expectOk(
      await sendCook(bench, [
        buildCookInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          potSalt: salt,
          pot,
          feeConfig: bench.feeConfig,
          bytecode: PROGRAM,
          maxExecutionFee: 0n,
          tail: [...tail],
        }),
      ]),
      "cook",
    );
  });

  it("cook_from_account executes a finalized code account", async () => {
    const salt = new Uint8Array(32).fill(22);
    const nonce = 21n;
    const { pot, tail } = await potFor(salt);
    const { address: codeBuffer } = await deriveCodeBufferPda(
      bench.kitchen,
      bench.owner.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(bench.kitchen, codeBuffer);
    const accounts = { kitchen: bench.kitchen, owner: bench.owner.address, codeBuffer, code };

    expectOk(
      await send(bench, [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: PROGRAM.length }),
      ]),
      "create_code_buffer",
    );
    expectOk(
      await send(bench, [
        buildWriteCodeBufferInstruction({ ...accounts, offset: 0, chunk: PROGRAM }),
      ]),
      "write_code_buffer",
    );
    const digest = new Uint8Array(createHash("sha256").update(PROGRAM).digest());
    expectOk(
      await send(bench, [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: PROGRAM.length,
          expectedSha256: digest,
        }),
      ]),
      "finalize_code_buffer",
    );

    expectOk(
      await sendCook(bench, [
        buildCookFromAccountInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          codeBuffer,
          code,
          engineProgram: bench.engine,
          potSalt: salt,
          pot,
          feeConfig: bench.feeConfig,
          maxExecutionFee: 0n,
          tail: [...tail],
        }),
      ]),
      "cook_from_account",
    );
  });

  // The `pin` argument is the trust anchor for the staged transport: it refuses unless the staged
  // bytes hash to it, so a buffer swapped between finalize and cook cannot execute.
  it("cook_from_account refuses a pin that is not the staged bytes", async () => {
    const salt = new Uint8Array(32).fill(23);
    const nonce = 22n;
    const { pot, tail } = await potFor(salt);
    const { address: codeBuffer } = await deriveCodeBufferPda(
      bench.kitchen,
      bench.owner.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(bench.kitchen, codeBuffer);
    const accounts = { kitchen: bench.kitchen, owner: bench.owner.address, codeBuffer, code };

    expectOk(
      await send(bench, [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: PROGRAM.length }),
      ]),
      "create_code_buffer",
    );
    expectOk(
      await send(bench, [
        buildWriteCodeBufferInstruction({ ...accounts, offset: 0, chunk: PROGRAM }),
      ]),
      "write_code_buffer",
    );
    expectOk(
      await send(bench, [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: PROGRAM.length,
          expectedSha256: new Uint8Array(createHash("sha256").update(PROGRAM).digest()),
        }),
      ]),
      "finalize_code_buffer",
    );

    const result = await sendCook(bench, [
      buildCookFromAccountInstruction({
        kitchen: bench.kitchen,
        owner: bench.owner.address,
        codeBuffer,
        code,
        engineProgram: bench.engine,
        potSalt: salt,
        pot,
        feeConfig: bench.feeConfig,
        pin: new Uint8Array(32).fill(0xff),
        maxExecutionFee: 0n,
        tail: [...tail],
      }),
    ]);

    expectKitchenError(result, "CodeBufferHashMismatch");
  });

  // A CPI-created account cannot be allocated more than GROWTH_STEP at once, so a larger buffer is
  // created small and grown. Untested, this is where a >10 KB program silently fails to stage.
  it("grow_code_buffer walks a buffer past the one-shot allocation limit", async () => {
    const nonce = 23n;
    const capacity = GROWTH_STEP + 1024;
    const { address: codeBuffer } = await deriveCodeBufferPda(
      bench.kitchen,
      bench.owner.address,
      nonce,
    );
    const { address: code } = await deriveCodePda(bench.kitchen, codeBuffer);
    const accounts = { kitchen: bench.kitchen, owner: bench.owner.address, codeBuffer, code };

    expectOk(
      await send(bench, [buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity })]),
      "create_code_buffer",
    );
    // The create tops out at one step; the account is not yet the full capacity.
    expect(present(bench.svm, code, "the code account").data.length).toBeLessThan(capacity);

    expectOk(await send(bench, [buildGrowCodeBufferInstruction(accounts)]), "grow_code_buffer");

    expect(present(bench.svm, code, "the grown code account").data.length).toBe(capacity);
  });
});

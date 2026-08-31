/**
 * Staged execution end-to-end on LiteSVM: the buffer lifecycle through the SDK's pure builders
 * (init_buffer → chunked write_buffer → finalize_buffer → execute_from_account → close_buffer), the
 * hash-pin trust anchor, the lazy-`NoSigner` contract, and the whole point of staging — a program too
 * large for the 1232-byte packet running from a buffer.
 *
 * TWO ENGINES, DELIBERATELY. The staging protocol's instruction encoding targets the VENDORED
 * beta-lineage `artifacts/svm/engine.so`; the compiler this repo consumes emits for the `main`
 * lineage, and the release engine rejects these staging instructions (`Custom { code: 11 }`) even on
 * hand-written bytecode that never went through a compiler. So everything staged runs under
 * `describeSvm` on hand-written bytecode, and the two cases that need COMPILED output run inline
 * under `describeRustSvm` on the matching engine — see `svm-settle.e2e.test.ts`'s header for the same
 * split, stated from the other side.
 *
 * NOT RESTORED: the payload-args pair ("stage once, execute many with different args in ONE
 * instruction"). Those depended on `compile(..., { staged: true, args })` — a `argsLayout` the SDK
 * fed to `encodePayloadArgs` — and the compiler this repo now uses has neither option: a program's
 * per-execution values are `defines` folded into the bytecode, so one blob no longer serves several
 * arg sets. There is nothing left to assert, not a gap in coverage.
 */
import { createHash } from 'node:crypto';
import {
  buildCloseBufferInstruction,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
  buildHeapFramePrepend,
  buildStagingPlan,
  resolveAccounts,
} from '../../src/svm/index.js';
import {
  buildExecuteTransactionForHarness,
  describeRustSvm,
  describeSvm,
  executeStaged,
  expectFail,
  expectOk,
  getTransactionSize,
  RUST_ENGINE_SO,
  sendInstructions,
  seed32,
  stageBytecode,
  startEngine,
  toBigInt,
} from './engine-harness.js';
import type { EngineHarness } from './engine-harness.js';
import { compileSource } from '../helpers';

const sha256 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(bytes).digest());

describeSvm('staged e2e: buffer lifecycle (stage 4 KB → execute_from_account → close)', () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  it('stages a ~4 KB program in the pinned 8-tx protocol, executes it, and closes for a full refund', async () => {
    // A ~4 KB straight-line program: n x [BYTE_1 42][SDROP], then BYTE_2 0xBEEF, STOP.
    const filler = Array.from({ length: 1364 }, () => [0x01, 0x2a, 0xe0]).flat();
    const bytecode = new Uint8Array([...filler, 0x02, 0xbe, 0xef, 0x00]);
    expect(bytecode.length).toBeGreaterThan(4000);
    expect(buildStagingPlan(bytecode.length).transactions.total).toBe(8);

    const buffer = await stageBytecode(harness, seed32(0), bytecode);
    // no declared slots, no signer needed: pure compute never reads MSG_SENDER
    const accounts = resolveAccounts({ accounts: [] }, {}, harness.payer.address);

    const result = expectOk(await executeStaged(harness, buffer, accounts, { pin: sha256(bytecode) }));
    expect(toBigInt(result.returnData)).toBe(0xbeefn);

    // close: rent lands back on the payer, the account is reaped
    const before = harness.svm.getBalance(harness.payer.address);
    const bufferLamports = harness.svm.getBalance(buffer);
    expect(bufferLamports).toBeGreaterThan(0n);
    expectOk(
      await sendInstructions(harness, [
        buildCloseBufferInstruction({ programId: harness.programId, authority: harness.payer.address, buffer }),
      ]),
    );
    expect(harness.svm.getBalance(buffer) ?? 0n).toBe(0n); // reaped
    expect(harness.svm.getBalance(harness.payer.address)).toBe(before! + bufferLamports! - 5000n); // minus the tx fee
  });

  it('rejects a wrong 32-byte hash pin (BufferHashMismatch) — the cross-lifecycle trust anchor', async () => {
    const bytecode = new Uint8Array([0x01, 0x2a, 0x00]); // BYTE_1 42, STOP
    const buffer = await stageBytecode(harness, seed32(1), bytecode);
    const accounts = resolveAccounts({ accounts: [] }, {}, harness.payer.address);

    const wrongPin = sha256(bytecode);
    wrongPin[0] ^= 0xff;
    expectFail(await executeStaged(harness, buffer, accounts, { pin: wrongPin }));

    // the correct pin (and the pinless owner path) still execute
    expect(toBigInt(expectOk(await executeStaged(harness, buffer, accounts, { pin: sha256(bytecode) })).returnData)).toBe(42n);
    expect(toBigInt(expectOk(await executeStaged(harness, buffer, accounts)).returnData)).toBe(42n);
  });

  it('an execute transaction without RequestHeapFrame aborts before any opcode', async () => {
    const bytecode = new Uint8Array([0x01, 0x2a, 0x00]); // BYTE_1 42, STOP
    const buffer = await stageBytecode(harness, seed32(5), bytecode);
    const accounts = resolveAccounts({ accounts: [] }, {}, harness.payer.address);

    // Same instruction, no heap-frame request: the claim probe hits unmapped
    // memory (SBF AccessViolation) — deterministic, zero state at risk.
    const bare = buildExecuteFromAccountInstruction({
      programId: harness.programId,
      buffer,
      accounts,
      expectedSha256: sha256(bytecode),
    });
    expectFail(await sendInstructions(harness, [bare]));
  });

  it('a signerless staged execute works too (the buffer is not a signer)', async () => {
    const bytecode = new Uint8Array([0x01, 0x07, 0x01, 0x06, 0x23, 0x00]); // 7 * 6, STOP
    const buffer = await stageBytecode(harness, seed32(6), bytecode);

    const execute = buildExecuteFromAccountInstruction({
      programId: harness.programId,
      buffer,
      accounts: [],
      expectedSha256: sha256(bytecode),
    });
    const result = expectOk(await sendInstructions(harness, [buildHeapFramePrepend(), execute]));
    expect(toBigInt(result.returnData)).toBe(42n);
  });
});

describeSvm('staged e2e: a program too large for the packet runs staged — the whole point', () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  it('a ~1.5 KB program cannot ship inline (packet overflow) but executes from a buffer', async () => {
    // Same straight-line shape as the 4 KB case, sized just past the packet cap: n x [BYTE_1 42]
    // [SDROP], then BYTE_2 0xBEEF, STOP.
    const filler = Array.from({ length: 500 }, () => [0x01, 0x2a, 0xe0]).flat();
    const bytecode = new Uint8Array([...filler, 0x02, 0xbe, 0xef, 0x00]);
    expect(bytecode.length).toBeGreaterThan(1232); // cannot fit a packet even bare

    // The inline impossibility, measured on the real wire encoding of a real signed transaction —
    // stronger than the compiler warning this used to assert, and it holds for any bytecode.
    const inline = await buildExecuteTransactionForHarness(harness, [
      buildHeapFramePrepend(),
      buildExecuteInstruction({ programId: harness.programId, bytecode, accounts: [] }),
    ]);
    expect(getTransactionSize(inline)).toBeGreaterThan(1232);

    const buffer = await stageBytecode(harness, seed32(4), bytecode);
    const result = expectOk(await executeStaged(harness, buffer, [], { pin: sha256(bytecode) }));
    expect(toBigInt(result.returnData)).toBe(0xbeefn);
  });
});

describeRustSvm('lazy NoSigner: signerless executes are valid unless MSG_SENDER is read', () => {
  let harness: EngineHarness;

  // Compiled bytecode, so this runs INLINE on the `main`-lineage engine rather than staged on the
  // vendored one — the split this file's header describes.
  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, RUST_ENGINE_SO!);
  });

  it('a pure-compute program executes with an EMPTY instruction account list', async () => {
    const { bytecode, manifest } = compileSource('function main(): Uint256 { return 41n + 1n; }', 'svm');
    const accounts = resolveAccounts(manifest!, {}, harness.payer.address);
    expect(accounts).toHaveLength(0); // signerless — and valid

    const execute = buildExecuteInstruction({ programId: harness.programId, bytecode, accounts });
    const result = expectOk(await sendInstructions(harness, [buildHeapFramePrepend(), execute]));
    expect(toBigInt(result.returnData)).toBe(42n);
  });

  it('a MSG_SENDER-reading program fails NoSigner without an in-list signer, passes with appendPayerSigner', async () => {
    // The manifest is EMPTY for this program too — MSG_SENDER is not a declared slot, which is what
    // makes the check lazy: the engine refuses at the read, not at attach time.
    const { bytecode, manifest } = compileSource('function main(): Uint256 { return ctx.msgSender(); }', 'svm');
    expect(manifest!.accounts).toHaveLength(0);

    const signerless = buildExecuteInstruction({
      programId: harness.programId,
      bytecode,
      accounts: resolveAccounts(manifest!, {}, harness.payer.address),
    });
    expectFail(await sendInstructions(harness, [buildHeapFramePrepend(), signerless]));

    const signed = buildExecuteInstruction({
      programId: harness.programId,
      bytecode,
      accounts: resolveAccounts(manifest!, {}, harness.payer.address, { appendPayerSigner: true }),
    });
    const result = expectOk(await sendInstructions(harness, [buildHeapFramePrepend(), signed]));
    expect(result.returnData).toHaveLength(32);
  });
});

/**
 * Staged execution end-to-end on LiteSVM: the full buffer lifecycle through
 * the sdk's pure builders (init_buffer → chunked write_buffer → finalize_buffer
 * → execute_from_account → close_buffer), the payload-args pattern (stage once,
 * execute many with different args in ONE instruction), the hash-pin trust
 * anchor, the lazy-NoSigner contract, and the whole point of staging — a
 * program too large for the 1232-byte packet running from a buffer.
 *
 * Runs against the vendored engine .so by default (SAUCE_ENGINE_SO
 * overrides); skips cleanly if that binary is somehow missing (same gate as
 * the other engine-bound suites).
 */
import { createHash } from 'node:crypto';
import { compile } from '@eco-incorp/sauce-compiler';
import {
  buildCloseBufferInstruction,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
  buildHeapFramePrepend,
  buildStagingPlan,
  resolveAccounts,
} from '../../src/svm/index.js';
import {
  describeSvm,
  executeStaged,
  expectFail,
  expectOk,
  sendInstructions,
  seed32,
  stageBytecode,
  startEngine,
  toBigInt,
  planToManifest,
} from './engine-harness.js';
import type { EngineHarness } from './engine-harness.js';

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
    // no plan refs, no signer needed: pure compute never reads MSG_SENDER
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
});

describeSvm('staged e2e: payload args (stage once, execute many, ONE instruction)', () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  it('one staged buffer serves different scalar args per execution', async () => {
    // Compile-time arg VALUES are placeholders — staged mode does not bake them.
    const { bytecode, accountPlan, argsLayout } = compile('function main(a, b) { return a * 1000000 + b }', {
      target: 'svm',
      staged: true,
      args: [0n, 0n],
    });
    expect(argsLayout!.mode).toBe('calldata');
    expect(argsLayout!.programLength).toBe(bytecode[0].length);

    const buffer = await stageBytecode(harness, seed32(2), bytecode[0]);
    const accounts = resolveAccounts(planToManifest(accountPlan!), {}, harness.payer.address);
    const pin = sha256(bytecode[0]);

    const first = expectOk(
      await executeStaged(harness, buffer, accounts, { pin, args: { layout: argsLayout!, values: [7n, 5n] } }),
    );
    expect(toBigInt(first.returnData)).toBe(7_000_005n);

    // Same buffer, same tx shape, different args → different result.
    const second = expectOk(
      await executeStaged(harness, buffer, accounts, { pin, args: { layout: argsLayout!, values: [123n, 456n] } }),
    );
    expect(toBigInt(second.returnData)).toBe(123_000_456n);
  });

  it('mixed scalar + bytes args ride the same payload', async () => {
    const { bytecode, accountPlan, argsLayout } = compile('function main(a, d) { return a + d[0] }', {
      target: 'svm',
      staged: true,
      args: [0n, '0x00'],
    });
    const buffer = await stageBytecode(harness, seed32(3), bytecode[0]);
    const accounts = resolveAccounts(planToManifest(accountPlan!), {}, harness.payer.address);

    const result = expectOk(
      await executeStaged(harness, buffer, accounts, {
        pin: sha256(bytecode[0]),
        args: { layout: argsLayout!, values: [10n, '0x2a'] },
      }),
    );
    expect(toBigInt(result.returnData)).toBe(52n); // 10 + 0x2a
  });
});

describeSvm('lazy NoSigner: signerless executes are valid unless MSG_SENDER is read', () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  it('a pure-compute program executes with an EMPTY instruction account list', async () => {
    const { bytecode, accountPlan } = compile('function main() { return 41 + 1 }', { target: 'svm' });
    const accounts = resolveAccounts(planToManifest(accountPlan!), {}, harness.payer.address);
    expect(accounts).toHaveLength(0); // signerless — and valid

    const execute = buildExecuteInstruction({ programId: harness.programId, bytecode: bytecode[0], accounts });
    const result = expectOk(await sendInstructions(harness, [buildHeapFramePrepend(), execute]));
    expect(toBigInt(result.returnData)).toBe(42n);
  });

  it('a MSG_SENDER-reading program fails NoSigner without an in-list signer, passes with appendPayerSigner', async () => {
    const { bytecode, accountPlan } = compile('function main() { return ctx.msgSender() }', { target: 'svm' });

    const signerless = buildExecuteInstruction({
      programId: harness.programId,
      bytecode: bytecode[0],
      accounts: resolveAccounts(planToManifest(accountPlan!), {}, harness.payer.address),
    });
    expectFail(await sendInstructions(harness, [buildHeapFramePrepend(), signerless]));

    const signed = buildExecuteInstruction({
      programId: harness.programId,
      bytecode: bytecode[0],
      accounts: resolveAccounts(planToManifest(accountPlan!), {}, harness.payer.address, { appendPayerSigner: true }),
    });
    const result = expectOk(await sendInstructions(harness, [buildHeapFramePrepend(), signed]));
    expect(result.returnData).toHaveLength(32);
  });

  it('a signerless staged execute works too (the buffer is not a signer)', async () => {
    const bytecode = new Uint8Array([0x01, 0x07, 0x01, 0x06, 0x23, 0x00]); // 7 * 6, STOP
    const buffer = await stageBytecode(harness, seed32(0), bytecode);

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

  it('a ~2.5 KB compiled program cannot ship inline (packet overflow) but executes from a buffer', async () => {
    // 500 statements over 250 distinct keys (the engine caps transient storage
    // at 256 keys; overwrites are free) — ~2.5 KB of bytecode.
    const body = Array.from({ length: 500 }, (_, i) => `storage.tWrite(${i % 250}, ${i + 1});`).join('\n');
    const src = `function main() { ${body} return storage.tRead(249) }`;
    const staged = compile(src, { target: 'svm', staged: true });
    expect(staged.bytecode[0].length).toBeGreaterThan(1232); // cannot fit a packet even bare

    // Inline impossibility, measured on the real wire encoding: the signed
    // inline-execute transaction exceeds the 1232-byte cap (LiteSVM has no
    // wire, so the size assertion IS the impossibility proof).
    const inline = compile(src, { target: 'svm' });
    expect(inline.warnings.join('\n')).toMatch(/exceeds the 1232-byte packet/);
    expect(staged.warnings).toEqual([]);

    const buffer = await stageBytecode(harness, seed32(4), staged.bytecode[0]);
    const accounts = resolveAccounts(planToManifest(staged.accountPlan!), {}, harness.payer.address);

    const result = expectOk(
      await executeStaged(harness, buffer, accounts, { pin: sha256(staged.bytecode[0]) }),
    );
    expect(toBigInt(result.returnData)).toBe(500n);
  });
});

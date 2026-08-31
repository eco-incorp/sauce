/**
 * Engine-gated end-to-end for the SVM `settle` recipe (`svm/recipes/settle.sauce.ts`).
 *
 * Proves the real on-chain behaviour against the vendored engine .so via LiteSVM (which loads the
 * real SPL Token and Token-2022 programs): TransferChecked (ix 12) sweeps work for classic SPL AND
 * Token-2022 mints, the floor gates atomically, and `SETTLE_SPL_COUNT` routes a mixed
 * classic/Token-2022 multi-escrow settle to one recipient's per-mint destinations. Skips cleanly if
 * the engine binary is missing (same gate as its siblings).
 *
 * `minOut`/`splCount` are compile-time defines, so a blob is specific to its
 * `(escrowCount, minOut, splCount)` triple. The account identities stay late-bound, which is why one
 * blob still serves every mint/recipient/owner.
 *
 * RUNS INLINE, not staged. The SDK's staged-execution instruction encoding
 * (`buffer_init`/`write`/`finalize` + `execute_from_account`) targets the vendored beta-lineage
 * engine, while compiler-emitted bytecode needs the matching `main`-lineage engine — the two cannot
 * be satisfied at once today (`test/svm/staged.e2e.test.ts` passes on the beta engine and fails at
 * its first staging instruction on the other one, with identical bytecode, which isolates the gap to
 * the staging protocol rather than the program). Inline `execute` is lineage-correct and carries the
 * whole behaviour under test here; N=1/N=2 (176/299 bytes) fit an instruction comfortably.
 *
 * WHY TransferChecked, not the legacy Transfer (ix 3): ix 3 reverts on a Token-2022 fee mint, so it
 * cannot honour "works for SPL or Token-2022". TransferChecked is the uniform instruction; the token
 * program checks the decimals the program passes against the mint's own (the program reads them out
 * of the attached mint, so they always agree). The fee-mint case itself is the token program's own
 * logic, not this recipe's — this suite proves the recipe emits ix 12 correctly for both programs.
 */
import { assertAccountExists, getAddressCodec, type Address } from '@solana/kit';
import {
  describeRustSvm,
  execute,
  expectFail,
  expectOk,
  randomAddress,
  setMint,
  setTokenAccount,
  startEngine,
  RUST_ENGINE_SO,
  toBigInt,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  transferCheckedData,
} from './engine-harness.js';
import type { EngineHarness } from './engine-harness.js';
import { svmSettleSource } from '../../src/svm/index.js';
import { compileSource } from '../helpers';
import type { AccountManifest } from 'sauce-next';

const DECIMALS = 6;
const amountOf = (harness: EngineHarness, a: Address): bigint => {
  const acc = harness.svm.getAccount(a);
  assertAccountExists(acc);
  return new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(64, true);
};

interface Compiled {
  bytecode: Uint8Array;
  manifest: AccountManifest;
}

describeRustSvm('svm settle e2e: TransferChecked sweeps, classic + Token-2022', () => {
  let harness: EngineHarness;
  const cache = new Map<string, Compiled>();

  /** The blob for one (escrowCount, minOut, splCount) triple — memoized, since it is a pure function. */
  const build = (escrowCount: number, minOut: bigint, splCount: bigint): Compiled => {
    const key = `${escrowCount}:${minOut}:${splCount}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const { bytecode, manifest } = compileSource(svmSettleSource(escrowCount), 'svm', {
      defines: { SETTLE_MIN_OUT: minOut, SETTLE_SPL_COUNT: splCount },
    });
    const entry: Compiled = { bytecode, manifest: manifest! };
    cache.set(key, entry);

    return entry;
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, RUST_ENGINE_SO!);
  });

  /** Run an N=1 blob for `minOut` against one escrow on program `tp` (tokenProgram0, splCount=1). */
  const runOne = async (p: {
    escrow: Address; mint: Address; dest: Address; owner: Address; minOut: bigint; tp: Address;
  }) => {
    return execute(harness, build(1, p.minOut, 1n), {
      tokenProgram0: p.tp,
      tokenProgram1: TOKEN_PROGRAM, // unused when splCount=1; still attached (dedups if == tp)
      escrow0: p.escrow,
      mint0: p.mint,
      dest0: p.dest,
      owner: { address: p.owner, signer: harness.payer },
    });
  };

  const mkEscrow = (mint: Address, owner: Address, amount: bigint, program: Address) => ({
    escrow: setTokenAccount(harness, randomAddress(), mint, owner, amount, program),
    dest: setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n, program),
  });

  it('classic SPL: floor met, sweeps the whole escrow via TransferChecked', async () => {
    const mint = setMint(harness, randomAddress(), DECIMALS, TOKEN_PROGRAM);
    const owner = harness.payer.address;
    const { escrow, dest } = mkEscrow(mint, owner, 1_000_000n, TOKEN_PROGRAM);

    const r = expectOk(await runOne({ escrow, mint, dest, owner, minOut: 1_000_000n, tp: TOKEN_PROGRAM }));
    expect(toBigInt(r.returnData)).toBe(1_000_000n);
    expect(amountOf(harness, escrow)).toBe(0n);
    expect(amountOf(harness, dest)).toBe(1_000_000n);
  });

  it('★ Token-2022: the SAME contract works against the Token-2022 program (what ix 3 could not guarantee)', async () => {
    const mint = setMint(harness, randomAddress(), DECIMALS, TOKEN_2022_PROGRAM);
    const owner = harness.payer.address;
    const { escrow, dest } = mkEscrow(mint, owner, 555_000n, TOKEN_2022_PROGRAM);

    const r = expectOk(await runOne({ escrow, mint, dest, owner, minOut: 0n, tp: TOKEN_2022_PROGRAM }));
    expect(toBigInt(r.returnData)).toBe(555_000n);
    expect(amountOf(harness, escrow)).toBe(0n);
    expect(amountOf(harness, dest)).toBe(555_000n);
  });

  it('floor unmet by one unit: reverts atomically, nothing moves', async () => {
    const mint = setMint(harness, randomAddress(), DECIMALS, TOKEN_PROGRAM);
    const owner = harness.payer.address;
    const { escrow, dest } = mkEscrow(mint, owner, 1_000_000n, TOKEN_PROGRAM);

    const r = expectFail(await runOne({ escrow, mint, dest, owner, minOut: 1_000_001n, tp: TOKEN_PROGRAM }));
    expect(Buffer.from(r.revertData).toString('utf8')).toBe('settle: balance below minOut');
    expect(amountOf(harness, escrow)).toBe(1_000_000n);
  });

  it('empty escrow, minOut=0: succeeds, returns 0, no transfer attempted', async () => {
    const mint = setMint(harness, randomAddress(), DECIMALS, TOKEN_PROGRAM);
    const owner = harness.payer.address;
    const { escrow, dest } = mkEscrow(mint, owner, 0n, TOKEN_PROGRAM);
    const r = expectOk(await runOne({ escrow, mint, dest, owner, minOut: 0n, tp: TOKEN_PROGRAM }));
    expect(toBigInt(r.returnData)).toBe(0n);
  });

  it('★ mixed N=2: splCount=1 routes escrow0 (classic) via tokenProgram0 and escrow1 (Token-2022) via tokenProgram1, one recipient', async () => {
    const owner = harness.payer.address;
    const recipient = randomAddress();

    const mint0 = setMint(harness, randomAddress(), DECIMALS, TOKEN_PROGRAM);
    const mint1 = setMint(harness, randomAddress(), DECIMALS, TOKEN_2022_PROGRAM);
    const escrow0 = setTokenAccount(harness, randomAddress(), mint0, owner, 100n, TOKEN_PROGRAM);
    const dest0 = setTokenAccount(harness, randomAddress(), mint0, recipient, 0n, TOKEN_PROGRAM);
    const escrow1 = setTokenAccount(harness, randomAddress(), mint1, owner, 200n, TOKEN_2022_PROGRAM);
    const dest1 = setTokenAccount(harness, randomAddress(), mint1, recipient, 0n, TOKEN_2022_PROGRAM);

    // splCount=1 → escrow0 via tokenProgram0 (classic), escrow1 via tokenProgram1 (2022).
    const r = expectOk(
      await execute(harness, build(2, 50n, 1n), {
        tokenProgram0: TOKEN_PROGRAM,
        tokenProgram1: TOKEN_2022_PROGRAM,
        escrow0, mint0, dest0,
        escrow1, mint1, dest1,
        owner: { address: owner, signer: harness.payer },
      }),
    );

    expect(toBigInt(r.returnData)).toBe(100n); // floor balance is escrow0's
    expect(amountOf(harness, escrow0)).toBe(0n);
    expect(amountOf(harness, dest0)).toBe(100n);
    expect(amountOf(harness, escrow1)).toBe(0n);
    expect(amountOf(harness, dest1)).toBe(200n);
  });

  it('cross-checks the CPI data bytes against the SDK helper: [tag 12][u64 LE amount][decimals]', () => {
    const amount = 123_456n;
    expect(transferCheckedData(amount, DECIMALS)).toEqual(
      Uint8Array.from([12, ...new Uint8Array(new BigUint64Array([amount]).buffer), DECIMALS]),
    );
  });
});

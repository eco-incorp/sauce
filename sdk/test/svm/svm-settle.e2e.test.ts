/**
 * Engine-gated end-to-end for the SVM `settle` recipe (`svm/recipes/settle.sauce.ts`).
 *
 * Proves the real on-chain behaviour against the vendored engine .so via LiteSVM (which loads the
 * real SPL Token and Token-2022 programs): TransferChecked (ix 12) sweeps work for classic SPL AND
 * Token-2022 mints, the floor gates atomically, one staged blob serves every combination, and the
 * `splCount` runtime arg routes a mixed classic/Token-2022 multi-escrow settle to one recipient's
 * per-mint destinations. Skips cleanly if the engine binary is missing (same gate as its siblings).
 *
 * WHY TransferChecked, not the legacy Transfer (ix 3): ix 3 reverts on a Token-2022 fee mint, so it
 * cannot honour "works for SPL or Token-2022". TransferChecked is the uniform instruction; the token
 * program checks the decimals the program passes against the mint's own (the program reads them out
 * of the attached mint, so they always agree). The fee-mint case itself is the token program's own
 * logic, not this recipe's — this suite proves the recipe emits ix 12 correctly for both programs.
 */
import { createHash } from 'node:crypto';
import { assertAccountExists, getAddressCodec, type Address } from '@solana/kit';
import { compile } from '@eco-incorp/sauce-compiler';
import { resolveAccounts } from '../../src/svm/index.js';
import {
  describeSvm,
  executeStaged,
  expectFail,
  expectOk,
  randomAddress,
  setMint,
  setTokenAccount,
  seed32,
  stageBytecode,
  startEngine,
  toBigInt,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  transferCheckedData,
} from './engine-harness.js';
import type { EngineHarness } from './engine-harness.js';
import { svmSettleSource } from '../../src/svm/index.js';

const sha256 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(bytes).digest());

/** The 32 pubkey bytes of `addr` as a big-endian scalar — the value form the program compares its
 *  CPI target against, derived from the address so the arg and the account ref cannot disagree. */
const scalarOf = (addr: Address): bigint => toBigInt(new Uint8Array(getAddressCodec().encode(addr)));

const DECIMALS = 6;
const amountOf = (harness: EngineHarness, a: Address): bigint => {
  const acc = harness.svm.getAccount(a);
  assertAccountExists(acc);
  return new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(64, true);
};

interface Staged {
  buffer: Address;
  pin: Uint8Array;
  plan: ReturnType<typeof compile>['accountPlan'];
  args: ReturnType<typeof compile>['argsLayout'];
}

describeSvm('svm settle e2e: TransferChecked sweeps, classic + Token-2022, one staged blob', () => {
  let harness: EngineHarness;
  const staged: Record<number, Staged> = {};

  const stage = async (index: number, escrowCount: number): Promise<Staged> => {
    const c = compile(svmSettleSource(escrowCount), { target: 'svm', staged: true, treeshake: true, args: [0n, 0n, 0n, 0n] });
    const buffer = await stageBytecode(harness, seed32(index), c.bytecode[0]!);
    return { buffer, pin: sha256(c.bytecode[0]!), plan: c.accountPlan, args: c.argsLayout };
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
    staged[1] = await stage(0, 1);
    staged[2] = await stage(1, 2);
  });

  /** Run the N=1 blob against one escrow on program `tp` (attached as tokenProgram0, splCount=1). */
  const runOne = async (p: {
    escrow: Address; mint: Address; dest: Address; owner: Address; minOut: bigint; tp: Address;
  }) => {
    const s = staged[1]!;
    const accounts = resolveAccounts(
      s.plan!,
      {
        tokenProgram0: p.tp,
        tokenProgram1: TOKEN_PROGRAM, // unused when splCount=1; still attached (dedups if == tp)
        escrow0: p.escrow,
        mint0: p.mint,
        dest0: p.dest,
        owner: { address: p.owner, signer: harness.payer },
      },
      harness.payer.address,
    );
    return executeStaged(harness, s.buffer, accounts, {
      pin: s.pin,
      args: { layout: s.args!, values: [p.minOut, 1n, scalarOf(p.tp), scalarOf(TOKEN_PROGRAM)] },
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
    const s = staged[2]!;
    const owner = harness.payer.address;
    const recipient = randomAddress();

    const mint0 = setMint(harness, randomAddress(), DECIMALS, TOKEN_PROGRAM);
    const mint1 = setMint(harness, randomAddress(), DECIMALS, TOKEN_2022_PROGRAM);
    const escrow0 = setTokenAccount(harness, randomAddress(), mint0, owner, 100n, TOKEN_PROGRAM);
    const dest0 = setTokenAccount(harness, randomAddress(), mint0, recipient, 0n, TOKEN_PROGRAM);
    const escrow1 = setTokenAccount(harness, randomAddress(), mint1, owner, 200n, TOKEN_2022_PROGRAM);
    const dest1 = setTokenAccount(harness, randomAddress(), mint1, recipient, 0n, TOKEN_2022_PROGRAM);

    const accounts = resolveAccounts(
      s.plan!,
      {
        tokenProgram0: TOKEN_PROGRAM,
        tokenProgram1: TOKEN_2022_PROGRAM,
        escrow0, mint0, dest0,
        escrow1, mint1, dest1,
        owner: { address: owner, signer: harness.payer },
      },
      harness.payer.address,
    );
    // splCount=1 → escrow0 via tokenProgram0 (classic), escrow1 via tokenProgram1 (2022).
    const r = expectOk(
      await executeStaged(harness, s.buffer, accounts, {
        pin: s.pin,
        args: { layout: s.args!, values: [50n, 1n, scalarOf(TOKEN_PROGRAM), scalarOf(TOKEN_2022_PROGRAM)] },
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

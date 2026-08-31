/**
 * SVM settle verify/decode — the SVM counterpart of the EVM `/verify` checker.
 *
 * `verifySvmSettleProgram` is recompile + byte-compare: a settle program's `minOut`/`splCount` are
 * compile-time defines folded into the bytecode and its accounts are attach slots, so there is
 * nothing to parse OUT of it. Genuineness is proven by recompiling `svmSettleSource(N)` with the
 * EXPECTED defines and byte-comparing — which pins the logic, the floor and the split in one
 * comparison, since all three are the same bytes.
 */
import { createHash } from 'node:crypto';
import { AccountRole, getAddressDecoder } from '@solana/kit';
import { EXECUTE_DISCRIMINATOR } from '../../src/svm/engine.js';
import { buildExecuteAndCloseInstruction, buildExecuteFromAccountInstruction } from '../../src/svm/instructions.js';
import { svmSettleRefs, svmSettleSource } from '../../src/svm/recipes/index.js';
import {
  decodeSvmSettleExecution,
  parseExecutePayload,
  verifySvmSettleExecution,
  verifySvmSettleProgram,
  type SvmSettleExpectation,
} from '../../src/svm/verify.js';
import { compileSource } from '../helpers';

const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PROGRAM = 'CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ';
const BUFFER = 'So11111111111111111111111111111111111111112';

const DEFAULT_EXPECTED: SvmSettleExpectation = { minOut: 777n, splCount: 1n };

/** What a partner does: compile the shipped source with this intent's defines. */
function partnerCompile(escrowCount: number, expected: SvmSettleExpectation = DEFAULT_EXPECTED) {
  return compileSource(svmSettleSource(escrowCount), 'svm', {
    defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
  });
}

/** A manifest carrying just the slot names, for the shape-only negative controls. */
const manifestOf = (names: readonly string[]) => ({
  accounts: names.map((name, index) => ({ kind: 'slot', index, name })),
});

describe('verifySvmSettleProgram', () => {
  it('accepts a genuine settle program and reports its escrow count + refs', () => {
    for (const n of [1, 2, 5, 8]) {
      const { bytecode, manifest } = partnerCompile(n);
      const result = verifySvmSettleProgram(bytecode, manifest!, DEFAULT_EXPECTED);
      expect(result.genuine).toBe(true);
      expect(result.escrowCount).toBe(n);
      expect(result.refs).toEqual(svmSettleRefs(n));
      expect(result.mismatch).toBeUndefined();
    }
  });

  it('rejects a program whose bytecode was tampered (one flipped byte)', () => {
    const { bytecode, manifest } = partnerCompile(2);
    const tampered = bytecode.slice();
    tampered[10] ^= 0xff;
    const result = verifySvmSettleProgram(tampered, manifest!, DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBe(2); // shape still inferred from the manifest
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it('★ rejects a genuine settle compiled for a DIFFERENT minOut — the floor is bound to the bytes', () => {
    // The whole point of folding the scalars in: a program enforcing minOut=1 cannot pass as one
    // enforcing minOut=777, because they are different bytecode.
    const { bytecode, manifest } = partnerCompile(2, { minOut: 1n, splCount: 1n });
    const result = verifySvmSettleProgram(bytecode, manifest!, DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/minOut=777, splCount=1/);
  });

  it('★ rejects a genuine settle compiled for a DIFFERENT splCount — the split is bound too', () => {
    const { bytecode, manifest } = partnerCompile(3, { minOut: 777n, splCount: 2n });
    const result = verifySvmSettleProgram(bytecode, manifest!, { minOut: 777n, splCount: 1n });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(3\)/);
  });

  it('accepts it again once the expectation names the values it was actually compiled with', () => {
    const expected: SvmSettleExpectation = { minOut: 4242n, splCount: 2n };
    const { bytecode, manifest } = partnerCompile(3, expected);
    expect(verifySvmSettleProgram(bytecode, manifest!, expected).genuine).toBe(true);
  });

  it('rejects a genuine blob paired with the WRONG manifest (slot-name mismatch)', () => {
    const { bytecode } = partnerCompile(2);
    // A manifest with the right COUNT (3·2+3=9) but a wrong name at one slot.
    const badRefs = svmSettleRefs(2).map((r, i) => (i === 4 ? 'not_a_settle_ref' : r));
    const result = verifySvmSettleProgram(bytecode, manifestOf(badRefs), DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/slots do not match svmSettleRefs\(2\)/);
  });

  it('rejects a manifest whose size fits no settle shape (not 3N+3)', () => {
    const { bytecode } = partnerCompile(1);
    const result = verifySvmSettleProgram(bytecode, manifestOf(['a', 'b']), DEFAULT_EXPECTED);
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBeNull();
    expect(result.mismatch).toMatch(/not 3N \+ 3/);
  });
});

// ── execution (calldata + accounts together) ──

const addrDecoder = getAddressDecoder();
/** A distinct valid base58 address per seed (0..255) — 32 bytes filled with `seed`. */
function makeAddr(seed: number): string {
  return addrDecoder.decode(new Uint8Array(32).fill(seed));
}
function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

interface FixtureOpts extends Partial<SvmSettleExpectation> {
  tp0?: string;
  tp1?: string;
}

/** Builds a real settle execution for `n` escrows via the shipped instruction builders, so the decoder
 *  is exercised as the true inverse of the real encoder. The execute payload carries no args tail —
 *  the program's values are in its bytecode. */
function buildFixture(n: number, opts: FixtureOpts = {}) {
  const { minOut = 777n, splCount = 1n, tp0 = TOKENKEG, tp1 = TOKEN_2022 } = opts;
  const expected: SvmSettleExpectation = { minOut, splCount };
  const { bytecode } = partnerCompile(n, expected);
  const refs = svmSettleRefs(n);
  const addrByRef: Record<string, string> = {};
  refs.forEach((ref, i) => {
    addrByRef[ref] = ref === 'tokenProgram0' ? tp0 : ref === 'tokenProgram1' ? tp1 : makeAddr(i + 1);
  });
  const userMetas = refs.map((ref) => ({ address: addrByRef[ref] as never, role: AccountRole.READONLY }));
  const pin = sha256(bytecode);
  const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: userMetas, expectedSha256: pin });
  return { bytecode, refs, addrByRef, userMetas, ix, pin, expected, tp0, tp1 };
}

/** The bare `{ address }` account list a raw instruction gives you. */
const bareAccounts = (ix: { accounts?: readonly { address: unknown }[] }) =>
  ix.accounts!.map((a) => ({ address: a.address as string }));

describe('parseExecutePayload', () => {
  it('splits [disc][flags][pin] into its parts, with an empty args tail', () => {
    const { ix, pin } = buildFixture(1);
    const parsed = parseExecutePayload(ix.data as Uint8Array);
    expect(parsed.instruction).toBe('execute_from_account');
    expect(parsed.pin).toEqual(pin);
    expect(parsed.slice).toBeUndefined();
    expect(parsed.args.length).toBe(0);
  });

  it('rejects an inline execute discriminator (its payload is bytecode, not args)', () => {
    const inline = new Uint8Array([...EXECUTE_DISCRIMINATOR, 0x00, 0x01, 0x02]);
    expect(() => parseExecutePayload(inline)).toThrow(/inline `execute`/);
  });

  it('rejects a discriminator that is not a Sauce execute instruction', () => {
    expect(() => parseExecutePayload(new Uint8Array(16))).toThrow(/staged-execute discriminator/);
  });
});

describe('decodeSvmSettleExecution', () => {
  it('resolves account identities from a real instruction (buffer-prefixed list)', () => {
    const fx = buildFixture(2);
    const decoded = decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: bareAccounts(fx.ix) });

    expect(decoded.instruction).toBe('execute_from_account');
    expect(decoded.hadBufferAccount).toBe(true);
    expect(decoded.escrowCount).toBe(2);
    expect(decoded.refs).toEqual(svmSettleRefs(2));
    // Every ref resolved to the pubkey the fixture attached at that slot.
    for (const ref of decoded.refs) expect(decoded.accounts[ref]).toBe(fx.addrByRef[ref]);
    expect(decoded.pin).toEqual(fx.pin);
    expect(decoded.labeledRefsConsistent).toBeNull(); // bare {address} entries carry no ref label
  });

  it('decodes the recipes split shape (user-tail accounts with ref labels, no buffer)', () => {
    const fx = buildFixture(3);
    // Mirror `execution.accounts[]`: user tail only, each { pubkey, ref }.
    const accounts = fx.refs.map((ref) => ({ pubkey: fx.addrByRef[ref], isSigner: false, isWritable: true, ref }));
    const decoded = decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts });

    expect(decoded.hadBufferAccount).toBe(false);
    expect(decoded.escrowCount).toBe(3);
    expect(decoded.accounts.owner).toBe(fx.addrByRef.owner);
    expect(decoded.labeledRefsConsistent).toBe(true);
  });

  it('reports labeledRefsConsistent=false when an entry carries a wrong ref label', () => {
    const fx = buildFixture(2);
    const accounts = fx.refs.map((ref, i) => ({ pubkey: fx.addrByRef[ref], ref: i === 4 ? 'not_a_ref' : ref }));
    const decoded = decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts });
    expect(decoded.labeledRefsConsistent).toBe(false);
    // Identities still resolve positionally regardless of the bogus label.
    expect(decoded.accounts[fx.refs[4]!]).toBe(fx.addrByRef[fx.refs[4]!]);
  });

  it('decodes an execute_and_close payload', () => {
    const fx = buildFixture(1);
    const ix = buildExecuteAndCloseInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: fx.pin });
    const decoded = decodeSvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: bareAccounts(ix) });
    expect(decoded.instruction).toBe('execute_and_close');
    expect(decoded.escrowCount).toBe(1);
  });

  it('rejects an account list whose size fits no settle shape', () => {
    const fx = buildFixture(1);
    expect(() => decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: [makeAddr(1), makeAddr(2)] })).toThrow(
      /neither 3N\+3.*nor 3N\+4/,
    );
  });
});

describe('verifySvmSettleExecution', () => {
  it('verifies a genuine execution end to end (bytecode byte-match + pin↔bytecode tie)', () => {
    const fx = buildFixture(2, { minOut: 999n });
    const result = verifySvmSettleExecution({
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
      bytecode: fx.bytecode,
      ...fx.expected,
    });
    expect(result.genuine).toBe(true);
    expect(result.pinMatchesBytecode).toBe(true);
    expect(result.mismatch).toBeUndefined();
  });

  it('★ rejects a genuine execution checked against the WRONG expected minOut', () => {
    const fx = buildFixture(2, { minOut: 999n });
    const result = verifySvmSettleExecution({
      instructionData: fx.ix.data as Uint8Array,
      accounts: bareAccounts(fx.ix),
      bytecode: fx.bytecode,
      minOut: 1n,
      splCount: 1n,
    });
    expect(result.genuine).toBe(false);
    expect(result.bytecodeMatchesCanonical).toBe(false);
  });

  it('rejects tampered bytecode (byte-match fails)', () => {
    const fx = buildFixture(2);
    const tampered = fx.bytecode.slice();
    tampered[10] ^= 0xff;
    // Re-pin the calldata to the tampered bytecode so the failure is the byte-match, not the pin.
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: sha256(tampered) });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: bareAccounts(ix), bytecode: tampered, ...fx.expected });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it('rejects a calldata pin that does not equal sha256(bytecode)', () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: new Uint8Array(32) /* wrong pin */ });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: bareAccounts(ix), bytecode: fx.bytecode, ...fx.expected });
    expect(result.genuine).toBe(false);
    expect(result.pinMatchesBytecode).toBe(false);
    expect(result.mismatch).toMatch(/pin does not equal sha256/);
  });

  it('proves genuineness via the calldata PIN alone, with NO partner bytecode', () => {
    // fx.ix was pinned to sha256(the real settle bytecode) == sha256(canonical) — the SDK recompiles the
    // canonical settle itself and matches the pin, so a partner needs no bytecode.
    const fx = buildFixture(2, { minOut: 321n });
    const result = verifySvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: bareAccounts(fx.ix), ...fx.expected });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe('pin');
    expect(result.pinMatchesCanonical).toBe(true);
    expect(result.bytecodeMatchesCanonical).toBeNull();
  });

  it('rejects a settle-SHAPED decoy whose pin does not match the canonical settle (no bytecode)', () => {
    // Same account shape as a real settle (3·1+3) but a pin that is NOT the canonical settle hash —
    // exactly the adversarial decoy the shape-only path would have misread.
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: new Uint8Array(32).fill(0xab) });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: bareAccounts(ix), ...fx.expected });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe('pin');
    expect(result.pinMatchesCanonical).toBe(false);
    expect(result.mismatch).toMatch(/pin does not match sha256/);
  });

  it('is NOT genuine when the calldata carries no pin and no bytecode is supplied', () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas }); // no expectedSha256 → no pin
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: bareAccounts(ix), ...fx.expected });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe('none');
    expect(result.pin).toBeUndefined();
    expect(result.mismatch).toMatch(/no calldata pin and no bytecode/);
  });
});

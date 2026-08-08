/**
 * SVM settle verify/decode — the SVM counterpart of the EVM `/verify` decoder.
 *
 * verifySvmSettleProgram: recompile + byte-compare (the staged blob has no prologue to parse, so
 * genuineness is proven by recompiling svmSettleSource(N) and byte-comparing, not by decoding params
 * out of the bytecode). decodeSvmSettleArgs: the exact inverse of encodePayloadArgs for the four
 * settle scalar slots, from the per-execution calldata tail.
 */
import { createHash } from 'node:crypto';
import { AccountRole, getAddressDecoder, getAddressEncoder } from '@solana/kit';
import { compile } from '@eco-incorp/sauce-compiler';
import { encodePayloadArgs } from '../../src/svm/args.js';
import { EXECUTE_DISCRIMINATOR } from '../../src/svm/engine.js';
import { buildExecuteAndCloseInstruction, buildExecuteFromAccountInstruction } from '../../src/svm/instructions.js';
import { svmSettleRefs, svmSettleSource } from '../../src/svm/recipes/index.js';
import {
  SVM_SETTLE_ARGS_BYTES,
  decodeSvmSettleArgs,
  decodeSvmSettleExecution,
  parseExecutePayload,
  verifySvmSettleExecution,
  verifySvmSettleProgram,
} from '../../src/svm/verify.js';

const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PROGRAM = 'CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ';
const BUFFER = 'So11111111111111111111111111111111111111112';

function partnerCompile(escrowCount: number) {
  return compile(svmSettleSource(escrowCount), { target: 'svm', staged: true, treeshake: true, args: [0n, 0n, 0n, 0n] });
}

/** BE u256 scalar of a pubkey's 32 bytes — how a token-program address rides a scalar arg slot. */
function addressScalar(addr: string): bigint {
  let v = 0n;
  for (const b of getAddressEncoder().encode(addr as never)) v = (v << 8n) | BigInt(b);
  return v;
}

describe('verifySvmSettleProgram', () => {
  it('accepts a genuine settle program and reports its escrow count + refs', () => {
    for (const n of [1, 2, 5, 8]) {
      const { bytecode, accountPlan } = partnerCompile(n);
      const result = verifySvmSettleProgram(bytecode[0]!, accountPlan!);
      expect(result.genuine).toBe(true);
      expect(result.escrowCount).toBe(n);
      expect(result.refs).toEqual(svmSettleRefs(n));
      expect(result.mismatch).toBeUndefined();
    }
  });

  it('rejects a program whose bytecode was tampered (one flipped byte)', () => {
    const { bytecode, accountPlan } = partnerCompile(2);
    const tampered = bytecode[0]!.slice();
    tampered[10] ^= 0xff;
    const result = verifySvmSettleProgram(tampered, accountPlan!);
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBe(2); // shape still inferred from the plan
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it('rejects a genuine blob paired with the WRONG account plan (ref mismatch)', () => {
    const { bytecode } = partnerCompile(2);
    // A plan with the right COUNT (3·2+3=9) but a wrong ref name at one slot.
    const badRefs = svmSettleRefs(2).map((r, i) => (i === 4 ? 'not_a_settle_ref' : r));
    const result = verifySvmSettleProgram(bytecode[0]!, { metas: badRefs.map((ref) => ({ ref })) });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/refs do not match svmSettleRefs\(2\)/);
  });

  it('rejects an account plan whose size fits no settle shape (not 3N+3)', () => {
    const { bytecode } = partnerCompile(1);
    const result = verifySvmSettleProgram(bytecode[0]!, { metas: [{ ref: 'a' }, { ref: 'b' }] }); // 2 accounts
    expect(result.genuine).toBe(false);
    expect(result.escrowCount).toBeNull();
    expect(result.mismatch).toMatch(/not 3N \+ 3/);
  });
});

describe('decodeSvmSettleArgs', () => {
  it('round-trips the four args from a real encodePayloadArgs tail', () => {
    const { argsLayout } = partnerCompile(3);
    const values = [123456789n, 2n, addressScalar(TOKENKEG), addressScalar(TOKEN_2022)];
    const payload = encodePayloadArgs(argsLayout!, values);
    expect(payload.length).toBe(SVM_SETTLE_ARGS_BYTES);

    const decoded = decodeSvmSettleArgs(payload, argsLayout!);
    expect(decoded.minOut).toBe(123456789n);
    expect(decoded.splCount).toBe(2n);
    expect(decoded.tokenProgram0).toBe(TOKENKEG);
    expect(decoded.tokenProgram1).toBe(TOKEN_2022);
  });

  it('decodes a zero floor + single-program settle (tokenProgram1 == tokenProgram0)', () => {
    const { argsLayout } = partnerCompile(1);
    const payload = encodePayloadArgs(argsLayout!, [0n, 0n, addressScalar(TOKENKEG), addressScalar(TOKENKEG)]);
    const decoded = decodeSvmSettleArgs(payload);
    expect(decoded.minOut).toBe(0n);
    expect(decoded.tokenProgram0).toBe(TOKENKEG);
    expect(decoded.tokenProgram1).toBe(TOKENKEG);
  });

  it('rejects a payload that is not exactly 128 bytes', () => {
    expect(() => decodeSvmSettleArgs(new Uint8Array(96))).toThrow(/must be exactly 128 bytes/);
  });

  it('rejects an argsLayout that is not the settle shape', () => {
    const notSettle = { mode: 'calldata' as const, programLength: 0, byteLength: 32, slots: [{ arg: 0, kind: 'scalar' as const, offset: 0, length: 32 }] };
    expect(() => decodeSvmSettleArgs(new Uint8Array(128), notSettle)).toThrow(/not the settle shape/);
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

interface FixtureOpts {
  minOut?: bigint;
  splCount?: bigint;
  tp0?: string;
  tp1?: string;
}

/** Builds a real settle execution for `n` escrows via the shipped instruction builders, so the decoder
 *  is exercised as the true inverse of the real encoder. `tokenProgram{0,1}` accounts equal the args'
 *  token programs (as the recipe binds them), so the fixture is token-program-consistent by default. */
function buildFixture(n: number, opts: FixtureOpts = {}) {
  const { minOut = 777n, splCount = 1n, tp0 = TOKENKEG, tp1 = TOKEN_2022 } = opts;
  const { bytecode, argsLayout } = partnerCompile(n);
  const args = encodePayloadArgs(argsLayout!, [minOut, splCount, addressScalar(tp0), addressScalar(tp1)]);
  const refs = svmSettleRefs(n);
  const addrByRef: Record<string, string> = {};
  refs.forEach((ref, i) => {
    addrByRef[ref] = ref === 'tokenProgram0' ? tp0 : ref === 'tokenProgram1' ? tp1 : makeAddr(i + 1);
  });
  const userMetas = refs.map((ref) => ({ address: addrByRef[ref] as never, role: AccountRole.READONLY }));
  const pin = sha256(bytecode[0]!);
  const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: userMetas, expectedSha256: pin, args });
  return { bytecode: bytecode[0]!, args, refs, addrByRef, userMetas, ix, pin, minOut, splCount, tp0, tp1 };
}

describe('parseExecutePayload', () => {
  it('splits [disc][flags][pin][args] into its parts', () => {
    const { ix, pin } = buildFixture(1);
    const parsed = parseExecutePayload(ix.data as Uint8Array);
    expect(parsed.instruction).toBe('execute_from_account');
    expect(parsed.pin).toEqual(pin);
    expect(parsed.slice).toBeUndefined();
    expect(parsed.args.length).toBe(SVM_SETTLE_ARGS_BYTES);
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
  it('decodes args + resolves account identities from a real instruction (buffer-prefixed list)', () => {
    const fx = buildFixture(2, { minOut: 123n, splCount: 1n });
    const decoded = decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: fx.ix.accounts!.map((a) => ({ address: a.address as string })) });

    expect(decoded.instruction).toBe('execute_from_account');
    expect(decoded.hadBufferAccount).toBe(true);
    expect(decoded.escrowCount).toBe(2);
    expect(decoded.refs).toEqual(svmSettleRefs(2));
    expect(decoded.args.minOut).toBe(123n);
    expect(decoded.args.splCount).toBe(1n);
    expect(decoded.args.tokenProgram0).toBe(TOKENKEG);
    expect(decoded.args.tokenProgram1).toBe(TOKEN_2022);
    // Every ref resolved to the pubkey the fixture attached at that slot.
    for (const ref of decoded.refs) expect(decoded.accounts[ref]).toBe(fx.addrByRef[ref]);
    expect(decoded.tokenProgramsConsistent).toBe(true);
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
    expect(decoded.tokenProgramsConsistent).toBe(true);
    expect(decoded.labeledRefsConsistent).toBe(true);
  });

  it('flags a token-program arg/account mismatch (args say TOKENKEG, account is TOKEN_2022)', () => {
    const fx = buildFixture(1, { tp0: TOKENKEG, tp1: TOKENKEG });
    // Keep the calldata args (tp0 = TOKENKEG) but attach TOKEN_2022 at the tokenProgram0 slot.
    const accounts = fx.refs.map((ref) => ({ pubkey: ref === 'tokenProgram0' ? TOKEN_2022 : fx.addrByRef[ref], ref }));
    const decoded = decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts });
    expect(decoded.tokenProgramsConsistent).toBe(false);
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
    const ix = buildExecuteAndCloseInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: fx.pin, args: fx.args });
    const decoded = decodeSvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: ix.accounts!.map((a) => ({ address: a.address as string })) });
    expect(decoded.instruction).toBe('execute_and_close');
    expect(decoded.escrowCount).toBe(1);
  });

  it('rejects an account list whose size fits no settle shape', () => {
    const fx = buildFixture(1);
    expect(() => decodeSvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: [makeAddr(1), makeAddr(2)] })).toThrow(/neither 3N\+3.*nor 3N\+4/);
  });
});

describe('verifySvmSettleExecution', () => {
  it('verifies a genuine execution end to end (bytecode byte-match + pin↔bytecode tie)', () => {
    const fx = buildFixture(2, { minOut: 999n });
    const result = verifySvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: fx.ix.accounts!.map((a) => ({ address: a.address as string })), bytecode: fx.bytecode });
    expect(result.genuine).toBe(true);
    expect(result.pinMatchesBytecode).toBe(true);
    expect(result.tokenProgramsConsistent).toBe(true);
    expect(result.args.minOut).toBe(999n);
    expect(result.mismatch).toBeUndefined();
  });

  it('rejects tampered bytecode (byte-match fails)', () => {
    const fx = buildFixture(2);
    const tampered = fx.bytecode.slice();
    tampered[10] ^= 0xff;
    // Re-pin the calldata to the tampered bytecode so the failure is the byte-match, not the pin.
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: sha256(tampered), args: fx.args });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: ix.accounts!.map((a) => ({ address: a.address as string })), bytecode: tampered });
    expect(result.genuine).toBe(false);
    expect(result.mismatch).toMatch(/byte-match svmSettleSource\(2\)/);
  });

  it('rejects a calldata pin that does not equal sha256(bytecode)', () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: new Uint8Array(32) /* wrong pin */, args: fx.args });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: ix.accounts!.map((a) => ({ address: a.address as string })), bytecode: fx.bytecode });
    expect(result.genuine).toBe(false);
    expect(result.pinMatchesBytecode).toBe(false);
    expect(result.mismatch).toMatch(/pin does not equal sha256/);
  });

  it('proves genuineness via the calldata PIN alone, with NO partner bytecode', () => {
    // fx.ix was pinned to sha256(the real settle bytecode) == sha256(canonical) — the SDK recompiles the
    // canonical settle itself and matches the pin, so a partner needs no bytecode.
    const fx = buildFixture(2, { minOut: 321n });
    const result = verifySvmSettleExecution({ instructionData: fx.ix.data as Uint8Array, accounts: fx.ix.accounts!.map((a) => ({ address: a.address as string })) });
    expect(result.genuine).toBe(true);
    expect(result.verifiedBy).toBe('pin');
    expect(result.pinMatchesCanonical).toBe(true);
    expect(result.bytecodeMatchesCanonical).toBeNull();
    expect(result.args.minOut).toBe(321n);
  });

  it('rejects a settle-SHAPED decoy whose pin does not match the canonical settle (no bytecode)', () => {
    // Same shape as a real settle (128-byte args tail, 3·1+3 accounts) but a pin that is NOT the canonical
    // settle hash — exactly the adversarial decoy the shape-only path would have misread.
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, expectedSha256: new Uint8Array(32).fill(0xab), args: fx.args });
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: ix.accounts!.map((a) => ({ address: a.address as string })) });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe('pin');
    expect(result.pinMatchesCanonical).toBe(false);
    expect(result.mismatch).toMatch(/pin does not match sha256/);
  });

  it('is NOT genuine when the calldata carries no pin and no bytecode is supplied', () => {
    const fx = buildFixture(1);
    const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: fx.userMetas, args: fx.args }); // no expectedSha256 → no pin
    const result = verifySvmSettleExecution({ instructionData: ix.data as Uint8Array, accounts: ix.accounts!.map((a) => ({ address: a.address as string })) });
    expect(result.genuine).toBe(false);
    expect(result.verifiedBy).toBe('none');
    expect(result.pin).toBeUndefined();
    expect(result.mismatch).toMatch(/no calldata pin and no bytecode/);
  });
});

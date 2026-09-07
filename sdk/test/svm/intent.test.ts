/**
 * @eco-incorp/sauce-sdk/svm/verify — SVM intent extraction (the partner-facing path).
 *
 * An external partner consuming an Eco intent has only this package. So the whole chain is exercised
 * here: decode the Portal CalldataWithAccounts envelope that wraps each SVM route call, then extract the
 * settle params + resolved account identities (optionally verifying against staged bytecode).
 *
 * The Portal byte layout is pinned by a HAND-BUILT fixture (independent of the SDK's own codec choice),
 * so a Portal IDL field-order/type change can't drift the decoder silently; the full extraction path
 * then round-trips a real settle execution wrapped in a real envelope.
 */
import { createHash } from 'node:crypto';
import {
  AccountRole,
  addEncoderSizePrefix,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getArrayEncoder,
  getBooleanEncoder,
  getBytesEncoder,
  getStructEncoder,
  getU8Encoder,
  getU32Encoder,
  type Address,
} from '@solana/kit';
import { EXECUTE_FROM_ACCOUNT_DISCRIMINATOR } from '../../src/svm/engine.js';
import { buildExecuteFromAccountInstruction } from '../../src/svm/instructions.js';
import { svmSettleRefs, svmSettleSource } from '../../src/svm/recipes/index.js';
import {
  decodePortalCalldataWithAccounts,
  extractSvmSettleFromCalls,
  extractSvmSettleFromIntent,
  type SvmSettleExpectation,
} from '../../src/svm/verify.js';
import { compileSource } from '../helpers';

const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PROGRAM = 'CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ' as Address;
const BUFFER = 'So11111111111111111111111111111111111111112';

const addrDecoder = getAddressDecoder();
function makeAddr(seed: number): Address {
  return addrDecoder.decode(new Uint8Array(32).fill(seed));
}
function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

// The inverse of the SDK's Portal envelope decoder — used only to build fixtures for the extraction path.
const envelopeEncoder = getStructEncoder([
  ['calldata', getStructEncoder([
    ['data', addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
    ['accountCount', getU8Encoder()],
  ])],
  ['accounts', getArrayEncoder(getStructEncoder([
    ['pubkey', getAddressEncoder()],
    ['isSigner', getBooleanEncoder()],
    ['isWritable', getBooleanEncoder()],
  ]), { size: getU32Encoder() })],
]);
function encodeEnvelope(instructionData: Uint8Array, accounts: { address: string; role: AccountRole }[]): Uint8Array {
  return new Uint8Array(
    envelopeEncoder.encode({
      calldata: { data: instructionData, accountCount: accounts.length },
      accounts: accounts.map((a) => ({ pubkey: a.address as never, isSigner: false, isWritable: false })),
    }),
  );
}

/** A real settle execution for `n` escrows, plus its Portal-envelope wrapping (full [buffer, ...user] list). */
function buildIntentFixture(n: number, opts: { minOut?: bigint } = {}) {
  const { minOut = 555n } = opts;
  const expected: SvmSettleExpectation = { minOut, splCount: 1n };
  const { bytecode } = compileSource(svmSettleSource(n), 'svm', {
    defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
  });
  const refs = svmSettleRefs(n);
  const addrByRef: Record<string, string> = {};
  refs.forEach((ref, i) => {
    addrByRef[ref] = ref === 'tokenProgram0' ? TOKENKEG : ref === 'tokenProgram1' ? TOKEN_2022 : makeAddr(i + 1);
  });
  const userMetas = refs.map((ref) => ({ address: addrByRef[ref] as never, role: AccountRole.READONLY }));
  const pin = sha256(bytecode);
  const ix = buildExecuteFromAccountInstruction({ programId: PROGRAM as never, buffer: BUFFER as never, accounts: userMetas, expectedSha256: pin });
  const envelope = encodeEnvelope((ix.data ?? new Uint8Array()) as Uint8Array, (ix.accounts ?? []).map((a) => ({ address: a.address as string, role: AccountRole.READONLY })));
  return { bytecode, envelope, refs, addrByRef, expected, n };
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

/** A route call's `target` as it rides the wire: the callee's 32-byte universal address, 0x-hex. */
function universalAddress(programId: Address): `0x${string}` {
  return `0x${Buffer.from(getAddressEncoder().encode(programId)).toString('hex')}`;
}

describe('decodePortalCalldataWithAccounts', () => {
  it('decodes a HAND-BUILT envelope byte-for-byte (independent layout pin)', () => {
    // [u32 data_len][data][u8 account_count][u32 accounts_len][ N×(32 pubkey + 1 isSigner + 1 isWritable) ]
    const bytes = new Uint8Array([
      ...u32le(3), 0xaa, 0xbb, 0xcc, // calldata.data = 0xaabbcc
      0x02, // calldata.account_count = 2
      ...u32le(2), // accounts vec len = 2
      ...new Array(32).fill(0x01), 0x01, 0x00, // acc0: pubkey 01*32, signer, !writable
      ...new Array(32).fill(0x02), 0x00, 0x01, // acc1: pubkey 02*32, !signer, writable
    ]);
    const decoded = decodePortalCalldataWithAccounts(bytes);
    expect(Array.from(decoded.instructionData)).toEqual([0xaa, 0xbb, 0xcc]);
    expect(decoded.accountCount).toBe(2);
    expect(decoded.accounts).toEqual([
      { pubkey: makeAddr(1), isSigner: true, isWritable: false },
      { pubkey: makeAddr(2), isSigner: false, isWritable: true },
    ]);
  });

  it('accepts the same envelope as 0x-hex and as base64', () => {
    const bytes = buildIntentFixture(1).envelope;
    const hex = ('0x' + Buffer.from(bytes).toString('hex'));
    const b64 = Buffer.from(bytes).toString('base64');
    const fromBytes = decodePortalCalldataWithAccounts(bytes);
    expect(decodePortalCalldataWithAccounts(hex).instructionData).toEqual(fromBytes.instructionData);
    expect(decodePortalCalldataWithAccounts(b64).accounts).toEqual(fromBytes.accounts);
  });
});

/** A settle-SHAPED decoy: a real execute_from_account instruction (valid discriminator, a 3N+3 account
 *  list) but NOT the genuine settle — either pinless, or pinned to a non-canonical hash. This is the
 *  adversarial input a shape-only detector would have misread. */
function decoyEnvelope(n: number, opts: { pin?: Uint8Array } = {}): Uint8Array {
  const refs = svmSettleRefs(n);
  const disc = EXECUTE_FROM_ACCOUNT_DISCRIMINATOR;
  const flags = opts.pin ? [0x01] : [0x00];
  const pin = opts.pin ? Array.from(opts.pin) : [];
  const instructionData = new Uint8Array([...disc, ...flags, ...pin]);
  const accounts = refs.map((_, i) => ({ address: makeAddr(200 + i), role: AccountRole.READONLY }));
  return encodeEnvelope(instructionData, accounts);
}

describe('extractSvmSettleFromIntent / extractSvmSettleFromCalls', () => {
  it('extracts + VERIFIES a genuine settle from an intent with no partner bytecode (pin proof)', () => {
    const fx = buildIntentFixture(2, { minOut: 4242n });
    const intent = { route: { calls: [{ data: fx.envelope }] } };
    const found = extractSvmSettleFromIntent(intent, fx.expected);
    expect(found).not.toBeNull();
    expect(found!.callIndex).toBe(0);
    expect(found!.escrowCount).toBe(2);
    expect(found!.hadBufferAccount).toBe(true); // the envelope carried the full [buffer, ...user] list
    expect(found!.accounts.owner).toBe(fx.addrByRef.owner);
    expect(found!.genuine).toBe(true); // verified via the calldata pin vs the SDK's recompiled canonical
    expect(found!.verifiedBy).toBe('pin');
  });

  it('additionally byte-matches when the staged bytecode is supplied', () => {
    const fx = buildIntentFixture(2);
    const found = extractSvmSettleFromIntent({ route: { calls: [{ data: fx.envelope }] } }, { bytecode: fx.bytecode, ...fx.expected });
    expect(found).not.toBeNull();
    expect(found!.genuine).toBe(true);
    expect(found!.verifiedBy).toBe('bytecode');
    expect(found!.bytecodeMatchesCanonical).toBe(true);
    expect(found!.pinMatchesBytecode).toBe(true);
  });

  it('finds the genuine settle call within a mixed batch', () => {
    const settle = buildIntentFixture(1);
    const junk = encodeEnvelope(new Uint8Array([1, 2, 3, 4, 5]), [
      { address: makeAddr(9), role: AccountRole.READONLY },
      { address: makeAddr(10), role: AccountRole.READONLY },
    ]);
    const found = extractSvmSettleFromCalls([{ data: junk }, { data: settle.envelope }], settle.expected);
    expect(found!.callIndex).toBe(1);
    expect(found!.escrowCount).toBe(1);
    expect(found!.genuine).toBe(true);
  });

  // ── adversarial: a shape-only decoy must NOT be reported as a settle ──

  it('REJECTS a settle-shaped decoy (does not misread it as a genuine settle)', () => {
    const expected: SvmSettleExpectation = { minOut: 555n, splCount: 1n };
    // Pinless decoy: right shape, no proof — the exact input the shape-only path accepted. Must yield null.
    expect(extractSvmSettleFromCalls([{ data: decoyEnvelope(1) }], expected)).toBeNull();
    // Pinned decoy whose pin is NOT the canonical settle hash — also rejected.
    expect(extractSvmSettleFromCalls([{ data: decoyEnvelope(1, { pin: new Uint8Array(32).fill(0xcd) }) }], expected)).toBeNull();
  });

  it('does not let a decoy earlier in the batch mask a genuine settle later (no masking)', () => {
    const settle = buildIntentFixture(1);
    const calls = [
      { data: decoyEnvelope(1, { pin: new Uint8Array(32).fill(0x11) }) }, // shape-match, wrong pin
      { data: settle.envelope }, // the real settle
    ];
    const found = extractSvmSettleFromCalls(calls, settle.expected);
    expect(found).not.toBeNull();
    expect(found!.callIndex).toBe(1); // scanned past the decoy to the genuine settle
    expect(found!.genuine).toBe(true);
  });

  // ── the callee ──

  it('surfaces the call target as base58, from either the 0x-hex or the base58 input form', () => {
    const fx = buildIntentFixture(1);
    const fromHex = extractSvmSettleFromCalls([{ data: fx.envelope, target: universalAddress(PROGRAM) }], fx.expected);
    const fromBase58 = extractSvmSettleFromCalls([{ data: fx.envelope, target: PROGRAM }], fx.expected);
    expect(fromHex!.target).toEqual({ kind: 'program', address: PROGRAM });
    expect(fromBase58!.target).toEqual({ kind: 'program', address: PROGRAM });
    // A call that carried no target says so in its own state — not `program`, and not `unreadable`.
    expect(extractSvmSettleFromCalls([{ data: fx.envelope }], fx.expected)!.target).toEqual({ kind: 'absent' });
  });

  // Matching is on the envelope's instruction data only — the callee is never inspected. The pin gate
  // that makes a genuine verdict meaningful is the Sauce engine's, so it carries no weight for an
  // arbitrary program accepting the same discriminator. Pinned because the verdict is `genuine` here
  // while that program may ignore the pin entirely: `target` is the caller's check.
  it('reports a genuine settle sent to ANY target — validating it is the caller\'s job', () => {
    const fx = buildIntentFixture(2);
    const attacker = makeAddr(0xfe);
    const found = extractSvmSettleFromCalls([{ data: fx.envelope, target: attacker }], fx.expected);

    expect(found).not.toBeNull();
    expect(found!.genuine).toBe(true);
    expect(found!.target).toEqual({ kind: 'program', address: attacker });
  });

  // The scan is typed `… | null` and reads attacker-supplied calls, so an unresolvable `target` must not
  // leave it by throwing — a caller holding that type writes no `try`. Reported as its OWN state, never
  // as `absent`: a callee check skipped because nothing was supplied is the caller's call, one skipped
  // because the supplied callee was garbage is a bypass.
  // `data` and `target` read a bare string differently — base64 for the Portal envelope, base58 for an
  // address — so `target` deliberately does NOT take `BytesInput`. Only a branded `Address` may be spent
  // as its base58 form, and that is the whole barrier between the two encodings; nothing at runtime can
  // tell which a caller meant. So the guard is the expect-error below: it fails
  // `tsc -p tsconfig.test.json` the moment the parameter widens back to a bare string.
  it('does not accept a bare string as a target — the base64/base58 split is enforced by the type', () => {
    const fx = buildIntentFixture(1);
    const unvalidated: string = 'CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ';

    // @ts-expect-error a bare string is base64 under `BytesInput`; a target is bytes, 0x-hex, or `Address`
    expect(extractSvmSettleFromCalls([{ data: fx.envelope, target: unvalidated }], fx.expected)).not.toBeNull();

    // Validated into an `Address`, the same characters resolve as base58 — never as base64.
    const found = extractSvmSettleFromCalls([{ data: fx.envelope, target: address(unvalidated) }], fx.expected);
    expect(found!.target).toEqual({ kind: 'program', address: PROGRAM });
  });

  it('reports an unresolvable target as `unreadable` instead of aborting the scan', () => {
    const fx = buildIntentFixture(1);
    const shortHex = extractSvmSettleFromCalls([{ data: fx.envelope, target: '0xdeadbeef' }], fx.expected);
    const notBase58 = extractSvmSettleFromCalls([{ data: fx.envelope, target: 'not a program id' as Address }], fx.expected);

    // The genuine settle is still FOUND — the whole extraction used to abort on the malformed target.
    for (const found of [shortHex, notBase58]) {
      expect(found).not.toBeNull();
      expect(found!.genuine).toBe(true);
      expect(found!.target.kind).toBe('unreadable');
    }
    expect(shortHex!.target).toEqual({ kind: 'unreadable', reason: expect.stringContaining('target is 4 bytes') });
    expect(notBase58!.target).toEqual({ kind: 'unreadable', reason: expect.stringContaining('base58') });
    // Distinguishable from the call that supplied nothing at all.
    expect(extractSvmSettleFromCalls([{ data: fx.envelope }], fx.expected)!.target).toEqual({ kind: 'absent' });
  });

  it('never reads the target of a call it rejects — a decoy\'s malformed target cannot abort the scan', () => {
    const fx = buildIntentFixture(1);
    const decoy = buildIntentFixture(1, { minOut: 1n }).envelope; // settle-shaped, wrong floor → not genuine
    const found = extractSvmSettleFromCalls(
      [{ data: decoy, target: '0xbeef' }, { data: fx.envelope, target: PROGRAM }],
      fx.expected,
    );

    expect(found!.callIndex).toBe(1);
    expect(found!.target).toEqual({ kind: 'program', address: PROGRAM });
  });

  it('returns null when no call carries a settle execution', () => {
    const expected: SvmSettleExpectation = { minOut: 555n, splCount: 1n };
    const junk = encodeEnvelope(new Uint8Array([9, 9, 9]), [{ address: makeAddr(7), role: AccountRole.READONLY }]);
    expect(extractSvmSettleFromCalls([{ data: junk }], expected)).toBeNull();
    // A call that is not even a Portal envelope is skipped, not thrown.
    expect(extractSvmSettleFromCalls([{ data: '0x1234' }], expected)).toBeNull();
  });
});

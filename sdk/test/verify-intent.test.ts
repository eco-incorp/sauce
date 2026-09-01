/**
 * @eco-incorp/sauce-sdk/verify — intent/cook extraction coverage.
 *
 * `decodeSettleCall` / `extractEvmSettleFromIntent` sit on top of `validateSettleProgram`: a producer
 * hands you an intent whose `route.calls[]` batch carries the settle payload as ONE ingredient inside a
 * `Pot.cook(bytes[])` call, so these unwrap the cook calldata and hand the settle ingredient to the
 * decoder. Everything below builds real `cook(bytes[])` calldata with viem and asserts the params
 * round-trip, that a non-cook / non-settle call yields null, and that the settle cook is found by
 * CONTENT within a mixed batch.
 *
 * Identification is by PROGRAM HASH, so the ingredients here carry the real compiled program from
 * `SETTLE_PROGRAM`, not a stand-in. That is the point of the two impostor cases below: a 391-byte
 * ingredient with a perfectly canonical argument tail is NOT the settle, and this layer must say so.
 */
import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import type { Hex } from 'viem';
import {
  decodeSettleCall,
  encodeSettleProgram,
  extractEvmSettleFromCalls,
  extractEvmSettleFromIntent,
  SETTLE_PROGRAM,
  SETTLE_WIRE,
} from '../src/verify/index';

const COOK_ABI = parseAbi(['function cook(bytes[] ingredients) payable returns (bytes)']);
const TOKEN0 = ('0x' + '11'.repeat(20)) as Hex;
const TOKEN1 = ('0x' + '22'.repeat(20)) as Hex;
const RECIPIENT = ('0x' + 'ab'.repeat(20)) as Hex;
const MINOUT = 1000n;

/** A real settle payload via the encoder — program + canonical tail. */
const SETTLE_PAYLOAD = encodeSettleProgram([TOKEN0, TOKEN1], MINOUT, RECIPIENT, SETTLE_PROGRAM);
/** The same canonical tail behind 391 bytes that are NOT the settle program. */
const IMPOSTOR = ('0x' + 'ee'.repeat(SETTLE_WIRE.PROGRAM_BYTES) + SETTLE_PAYLOAD.slice(2 + SETTLE_WIRE.PROGRAM_BYTES * 2)) as Hex;
/** A clearly non-settle ingredient (the swap half stands in as junk here). */
const SWAP_JUNK = '0xdeadbeef' as Hex;

function cook(ingredients: Hex[]): Hex {
  return encodeFunctionData({ abi: COOK_ABI, functionName: 'cook', args: [ingredients] });
}

describe('decodeSettleCall', () => {
  it('decodes the settle params from a cook(bytes[]) call', () => {
    const decoded = decodeSettleCall(cook([SETTLE_PAYLOAD]));
    expect(decoded).not.toBeNull();
    expect(decoded!.tokens.map((t) => BigInt(t))).toEqual([BigInt(TOKEN0), BigInt(TOKEN1)]);
    expect(decoded!.minOut).toBe(MINOUT);
    expect(BigInt(decoded!.recipient)).toBe(BigInt(RECIPIENT));
    expect(decoded!.ingredientIndex).toBe(0);
    expect(decoded!.programHash).toBe(SETTLE_WIRE.PROGRAM_HASH);
  });

  it('does NOT report a settle sitting behind a non-settle ingredient 0', () => {
    // cook() runs ingredients[0] and ignores the rest, so reporting the settle at index 1 would
    // describe a program that never executes -- for `cook([drain, honestSettle])`, the honest one.
    expect(decodeSettleCall(cook([SWAP_JUNK, SETTLE_PAYLOAD]))).toBeNull();
  });

  it('returns null for a non-cook call (wrong selector)', () => {
    const transfer = encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [RECIPIENT, 1n] });
    expect(decodeSettleCall(transfer)).toBeNull();
  });

  it('returns null for a cook whose ingredients are all non-settle', () => {
    expect(decodeSettleCall(cook([SWAP_JUNK]))).toBeNull();
  });

  it('returns null for malformed calldata', () => {
    expect(decodeSettleCall('0x1234' as Hex)).toBeNull();
  });

  it('returns null for an impostor — 391 bytes and a canonical tail, but not the settle program', () => {
    // The structural decode accepts this ingredient; identification by hash is what refuses it.
    expect(decodeSettleCall(cook([IMPOSTOR]))).toBeNull();
  });

  it('does NOT look past an impostor at ingredient 0 to a genuine settle behind it', () => {
    expect(decodeSettleCall(cook([IMPOSTOR, SETTLE_PAYLOAD]))).toBeNull();
    // the genuine payload at index 0 still decodes — a position rule, not a blanket refusal
    expect(decodeSettleCall(cook([SETTLE_PAYLOAD, IMPOSTOR]))!.ingredientIndex).toBe(0);
  });

  it('returns null for the genuine program carrying a non-canonical tail', () => {
    // Trailing slack: the engine would run it, this layer must not report params from it.
    expect(decodeSettleCall(cook([(SETTLE_PAYLOAD + '00'.repeat(32)) as Hex]))).toBeNull();
  });
});

describe('extractEvmSettleFromCalls / extractEvmSettleFromIntent', () => {
  const calls = [
    { data: encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [RECIPIENT, 5n] }), target: ('0x' + '01'.repeat(20)) as `0x${string}` },
    { data: cook([SWAP_JUNK]), target: ('0x' + '02'.repeat(20)) as `0x${string}` }, // the swap cook
    { data: cook([SETTLE_PAYLOAD]), target: ('0x' + '03'.repeat(20)) as `0x${string}` }, // the settle cook
  ];

  it('finds the settle cook by content within a mixed batch and reports its position + target', () => {
    const found = extractEvmSettleFromCalls(calls);
    expect(found).not.toBeNull();
    expect(found!.callIndex).toBe(2);
    expect(found!.target).toBe('0x' + '03'.repeat(20));
    expect(found!.minOut).toBe(MINOUT);
    expect(BigInt(found!.recipient)).toBe(BigInt(RECIPIENT));
  });

  it('extractEvmSettleFromIntent takes a duck-typed intent object', () => {
    const found = extractEvmSettleFromIntent({ route: { calls } });
    expect(found!.callIndex).toBe(2);
    expect(found!.tokens.map((t) => BigInt(t))).toEqual([BigInt(TOKEN0), BigInt(TOKEN1)]);
  });

  // The pin is re-pinned when compiler codegen changes; every intent already on chain still carries
  // the OLD program. Without an accepted-hash override those become unverifiable, which is the exact
  // failure this module exists to prevent.
  it('accepts a caller-supplied hash set, so a re-pin does not orphan published intents', () => {
    const hypotheticalNewPin = ('0x' + '99'.repeat(32)) as Hex;

    // pin rotated and the old hash NOT accepted -> the on-chain payload stops verifying
    expect(extractEvmSettleFromCalls([{ data: cook([SETTLE_PAYLOAD]) }], [hypotheticalNewPin])).toBeNull();

    // the same payload, with the historical hash still accepted -> readable again
    const found = extractEvmSettleFromCalls([{ data: cook([SETTLE_PAYLOAD]) }], [hypotheticalNewPin, SETTLE_WIRE.PROGRAM_HASH as Hex]);
    expect(found).not.toBeNull();
    expect(found!.minOut).toBe(MINOUT);
  });

  // programHash is always viem's lowercase keccak, so an uppercase historical pin would silently fail
  // to match and orphan the payloads `accepted` exists to keep readable -- as a bare null, with nothing
  // to diagnose it.
  it('matches accepted hashes case-insensitively', () => {
    const found = extractEvmSettleFromCalls([{ data: cook([SETTLE_PAYLOAD]) }], [SETTLE_WIRE.PROGRAM_HASH.toUpperCase() as Hex]);

    expect(found).not.toBeNull();
    expect(found!.minOut).toBe(MINOUT);
  });

  // Fail-CLOSED, matching validateSettleProgram, which refuses an empty pin list. Falling back to the
  // built-in pin would report "this is the audited settle" against an anchor the caller never listed.
  it('reports nothing for an empty accepted list rather than falling back to the pin', () => {
    expect(extractEvmSettleFromCalls([{ data: cook([SETTLE_PAYLOAD]) }], [])).toBeNull();
  });

  // The payload is split into program and tail at a byte offset BEFORE any hash is computed, so a
  // re-pin that changes the program's length -- the likely outcome of a codegen change -- cannot be
  // rescued by a bare hash: the historical payload splits at the CURRENT length, yielding a wrong
  // program and a short tail, and dies without any hash being compared. A pin carries its own length.
  it('reads a payload whose program is a different LENGTH, which a bare hash cannot', () => {
    // stand-in for a future compiler's longer settle: the real program plus 9 bytes
    const longerProgram = (SETTLE_PROGRAM + 'ab'.repeat(9)) as Hex;
    const longerBytes = SETTLE_WIRE.PROGRAM_BYTES + 9;
    const longerHash = keccak256(longerProgram);
    const payload = (longerProgram + SETTLE_PAYLOAD.slice(2 + SETTLE_WIRE.PROGRAM_BYTES * 2)) as Hex;
    const call = { data: cook([payload]) };

    // the same hash as a BARE entry is read at the current 391, so the program never hashes to it
    expect(extractEvmSettleFromCalls([call], [longerHash])).toBeNull();

    // carrying its length, the very same hash matches and the tail decodes
    const found = extractEvmSettleFromCalls([call], [{ hash: longerHash, bytes: longerBytes }]);
    expect(found).not.toBeNull();
    expect(found!.minOut).toBe(MINOUT);
    expect(found!.programHash).toBe(longerHash);
  });

  it('returns null when no call carries a settle cook', () => {
    expect(extractEvmSettleFromCalls([calls[0]!, calls[1]!])).toBeNull();
  });

  // Matching is on the cook selector and the ingredient bytes only -- the callee is never inspected.
  // The index-0 rule that makes a non-null result meaningful is a V12Pot property, so it carries no
  // weight for an arbitrary contract exposing the same selector. Pinned because the reported params
  // look correct here while the callee may ignore the payload entirely: `target` is the caller's check.
  it('reports a settle for a cook sent to ANY target — validating it is the caller\'s job', () => {
    const attacker = ('0x' + 'ff'.repeat(20)) as `0x${string}`;
    const found = extractEvmSettleFromCalls([{ data: cook([SETTLE_PAYLOAD]), target: attacker }]);

    expect(found).not.toBeNull();
    expect(found!.minOut).toBe(MINOUT);
    expect(found!.target).toBe(attacker);
  });

  // `V12Pot.cook` runs ingredients[0] and ignores the rest, so a scan that kept looking would report
  // the honest settle at index 1 for a payload whose index 0 is what actually executes.
  it('does not report a settle sitting behind a non-settle ingredient 0', () => {
    const decoy = `0x${'11'.repeat(64)}` as Hex;

    expect(decodeSettleCall(cook([decoy, SETTLE_PAYLOAD]))).toBeNull();
    // and the honest payload alone still decodes, so this is not just a blanket refusal
    expect(decodeSettleCall(cook([SETTLE_PAYLOAD]))).not.toBeNull();
  });
});

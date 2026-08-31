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
import { encodeFunctionData, parseAbi } from 'viem';
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

  it('finds the settle ingredient past a non-settle one in the same cook', () => {
    const decoded = decodeSettleCall(cook([SWAP_JUNK, SETTLE_PAYLOAD]));
    expect(decoded!.ingredientIndex).toBe(1);
    expect(decoded!.minOut).toBe(MINOUT);
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

  it('skips the impostor and finds the genuine settle later in the same cook', () => {
    const decoded = decodeSettleCall(cook([IMPOSTOR, SETTLE_PAYLOAD]));
    expect(decoded!.ingredientIndex).toBe(1);
    expect(decoded!.programHash).toBe(SETTLE_WIRE.PROGRAM_HASH);
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

  it('returns null when no call carries a settle cook', () => {
    expect(extractEvmSettleFromCalls([calls[0]!, calls[1]!])).toBeNull();
  });
});

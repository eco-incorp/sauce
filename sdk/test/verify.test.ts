/**
 * @eco-incorp/sauce-sdk/verify — decoder coverage against the appended-args wire.
 *
 * The corpus this runs on is `SETTLE_VECTORS` (payloads a conformant decoder must accept) and
 * `SETTLE_REJECTIONS` (payloads it must refuse). The rejection half is the load-bearing one: the
 * `engineAccepts` rows are byte strings a REAL v12 runtime accepts and runs, so a decoder that takes
 * them is not injective — see decode.ts §4. The `sweepsIdentically` subset is also provable identical
 * ON CHAIN against a standard ERC20; the rest are refused by the callee rather than by the engine, so
 * they are traps for the decoder all the same. The counts live in the assertions below, not here.
 *
 * `verify.compile.test.ts` re-derives `SETTLE_PROGRAM` from source on every run, so the pins here
 * are live rather than frozen; `verify-execution.e2e.test.ts` runs these same vectors on the engine.
 */
import {
  bestEffortDecode,
  decodeSettleProgram,
  encodeSettleProgram,
  parseSettleProgram,
  settlePayload,
  validateSettleProgram,
  SettleDecodeError,
  SETTLE_PROGRAM,
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
  SETTLE_WIRE,
} from '../src/verify/index';
import { keccak256 } from 'viem';
import type { Hex } from 'viem';

/** The `.code` a call is expected to reject with — asserted on the error, not just on "it threw". */
const expectCode = (run: () => unknown, code: string): void => {
  expect(run).toThrow(SettleDecodeError);
  try {
    run();
  } catch (e) {
    expect((e as SettleDecodeError).code).toBe(code);
  }
};

describe('@eco-incorp/sauce-sdk/verify', () => {
  describe('golden vectors — wire conformance', () => {
    for (const v of SETTLE_VECTORS) {
      it(`decodes ${v.name}`, () => {
        const d = decodeSettleProgram(settlePayload(v.args));
        expect(d.tokens.map((t) => BigInt(t))).toEqual(v.tokens.map((t) => BigInt(t)));
        expect(d.minOut).toBe(v.minOut);
        expect(BigInt(d.recipient)).toBe(BigInt(v.recipient));
        expect(d.floorToken).toBe(d.tokens[0]);
      });

      it(`validates ${v.name} against the pinned program hash`, () => {
        expect(validateSettleProgram(settlePayload(v.args)).programHash).toBe(SETTLE_WIRE.PROGRAM_HASH);
      });

      it(`round-trips ${v.name} through encodeSettleProgram`, () => {
        const reencoded = encodeSettleProgram(v.tokens, v.minOut, v.recipient, SETTLE_PROGRAM);
        expect(reencoded.toLowerCase()).toBe(settlePayload(v.args).toLowerCase());
      });

      it(`${v.name} occupies exactly 128 + 32N argument bytes`, () => {
        const d = decodeSettleProgram(settlePayload(v.args));
        expect(d.argsSize).toBe(128 + 32 * v.tokens.length);
        expect(d.payloadSize).toBe(SETTLE_WIRE.PROGRAM_BYTES + d.argsSize);
      });
    }

    it('every vector shares ONE identical program — the arguments never reach the compiler', () => {
      // The property the whole appended-args model rests on, and the reason a single hash pin covers
      // every argument set. Asserted across the corpus, and re-derived from source in
      // verify.compile.test.ts rather than only pinned here.
      const programs = new Set(SETTLE_VECTORS.map((v) => decodeSettleProgram(settlePayload(v.args)).program));
      expect(programs.size).toBe(1);
      expect([...programs][0]).toBe(SETTLE_PROGRAM.toLowerCase());
    });

    it('tokens are in SOURCE order — index 0 is the floor token, the wire does not reverse', () => {
      // The v1 prologue emitted the token pushes reversed; this wire does not. A decoder carrying
      // the old reversal over would silently name the wrong floor token on every multi-token sweep.
      const v = SETTLE_VECTORS.find((c) => c.tokens.length > 1)!;
      const d = decodeSettleProgram(settlePayload(v.args));
      expect(d.tokens).toEqual(v.tokens.map((t) => t.toLowerCase()));
      expect(BigInt(d.floorToken)).toBe(BigInt(v.tokens[0]!));
    });

    it('an address with leading zero bytes is an ordinary 32-byte word — the v1 trap is gone', () => {
      // Z = 0x…00ff00aa cost 3 bytes under the minimal-length push grammar and 32 here. Nothing
      // about it is special any more, which is exactly what this pins.
      const v = SETTLE_VECTORS.find((c) => c.name.includes('leading-zero-byte'))!;
      const d = decodeSettleProgram(settlePayload(v.args));
      expect(d.argsSize).toBe(128 + 32 * v.tokens.length);
      expect(BigInt(d.recipient)).toBe(BigInt('0x0000000000000000000000000000000000ff00aa'));
    });
  });

  describe('canonicality — the payloads a conformant decoder must refuse', () => {
    for (const r of SETTLE_REJECTIONS) {
      it(`rejects ${r.name} with ${r.code}`, () => {
        expectCode(() => decodeSettleProgram(settlePayload(r.args)), r.code);
      });
    }

    it('the traps are byte strings the ENGINE accepts — strictness here is deliberate, not defensive', () => {
      // If this count ever drops, a rejection stopped being a trap and became an ordinary malformed
      // input, and the case for refusing it needs restating rather than silently inheriting.
      expect(SETTLE_REJECTIONS.filter((r) => r.engineAccepts).map((r) => r.code)).toEqual([
        'TOKENS_OFFSET',
        'ARGS_OVERLONG',
        'DIRTY_ADDRESS_WORD',
        'DIRTY_ADDRESS_WORD',
        'ZERO_RECIPIENT',
      ]);
    });

    // The engine runs the dirty-recipient payload; a solc ERC20's own ABI check is what refuses it.
    // So it is a trap for the decoder but not provable on chain against a standard token, which is
    // why the e2e equivalence loop filters on `sweepsIdentically` rather than `engineAccepts`.
    it('separates engine acceptance from on-chain equivalence', () => {
      const engineRuns = SETTLE_REJECTIONS.filter((r) => r.engineAccepts);
      const provable = SETTLE_REJECTIONS.filter((r) => r.sweepsIdentically);

      expect(engineRuns).toHaveLength(5);
      expect(provable).toHaveLength(3);

      // The unverified-claims ledger: engine-accepted but not provable on chain, so asserted nowhere
      // but the corpus. Pinned here so it cannot drift the way the prose naming rows did.
      expect(SETTLE_REJECTIONS.filter((r) => r.engineAccepts && !r.sweepsIdentically).map((r) => r.name.split(' ')[0])).toEqual([
        'dirtyRecipient',
        'zeroRecipient',
      ]);
      expect(provable.every((r) => r.engineAccepts)).toBe(true);
    });

    it('a dirty token word decodes to the SAME address it would sweep — which is why it is refused', () => {
      // bestEffortDecode shows what the payload MEANS; decodeSettleProgram refuses it anyway,
      // because the engine masks those upper bytes and the two byte strings would decode alike.
      const trap = SETTLE_REJECTIONS.find((r) => r.name.startsWith('upperBytes'))!;
      const parse = parseSettleProgram(settlePayload(trap.args));
      expect(parse.tokenWords[0]! >> 160n).not.toBe(0n);
      expect(bestEffortDecode(parse)!.tokens[0]).toBe(SETTLE_VECTORS[0]!.tokens[0]!.toLowerCase());
    });

    it('DECLINES a non-canonical tokens pointer rather than reporting what it read', () => {
      // The engine follows the pointer; parseSettleProgram reads at the canonical offset. On this
      // payload those name different tokens, so a confident report would be the wrong answer.
      // The vector's padding word is 0x02 so the canonical read parses fully and the decline is
      // what produces null -- with an inconsistent count the parse bails first and cannot see it.
      const trap = SETTLE_REJECTIONS.find((r) => r.name.startsWith('tokensPointer'))!;
      const parse = parseSettleProgram(settlePayload(trap.args));

      expect(parse.fatal?.code).toBe('TOKENS_OFFSET');
      expect(parse.tokenWords.length).toBeGreaterThan(0);
      expect(bestEffortDecode(parse)).toBeNull();
    });

    // Unlike a dirty TOKEN word -- which the engine masks as a call target, so the masked answer is
    // what executes -- the recipient word is passed through unmasked. Reporting the masked address
    // would name a different 256-bit key than the transfer actually uses, so this declines instead.
    it('DECLINES a dirty recipient word rather than reporting the masked address', () => {
      const trap = SETTLE_REJECTIONS.find((r) => r.name.startsWith('dirtyRecipient'))!;
      const parse = parseSettleProgram(settlePayload(trap.args));

      expect(parse.fatal?.code).toBe('DIRTY_ADDRESS_WORD');
      expect(parse.recipientWord).not.toBe(parse.recipient);
      expect(bestEffortDecode(parse)).toBeNull();
    });
  });

  describe('validateSettleProgram pins', () => {
    // An empty list accepts nothing; returning a decode would hand back a program no caller vouched for.
    it('refuses an empty pin list rather than decoding unvouched bytes', () => {
      const payload = settlePayload(SETTLE_VECTORS[0]!.args);
      expectCode(() => validateSettleProgram(payload, []), 'PROGRAM_HASH');
    });

    // A pin whose length does not fit the payload produces a parse error about bytes read at the wrong
    // offset -- an artefact of trying that candidate. A hash mismatch is the real answer, so it must
    // win regardless of pin order; otherwise `.code` depends on configuration and a payload with a
    // perfectly canonical tail gets reported as having a malformed one.
    it('reports PROGRAM_HASH, not a later pin\'s parse error, whatever the pin order', () => {
      const impostor = ('0x' + 'ee'.repeat(SETTLE_WIRE.PROGRAM_BYTES) + settlePayload(SETTLE_VECTORS[0]!.args).slice(2 + SETTLE_WIRE.PROGRAM_BYTES * 2)) as Hex;
      const longer = { hash: ('0x' + '99'.repeat(32)) as Hex, bytes: SETTLE_WIRE.PROGRAM_BYTES + 9 };
      const current = { hash: SETTLE_WIRE.PROGRAM_HASH as Hex, bytes: SETTLE_WIRE.PROGRAM_BYTES };

      expectCode(() => validateSettleProgram(impostor, [current, longer]), 'PROGRAM_HASH');
      expectCode(() => validateSettleProgram(impostor, [longer, current]), 'PROGRAM_HASH');
    });

    // §5 offers encode-and-compare as the equivalent of validateSettleProgram, which now accepts
    // historical pins of other lengths. Pinning the current constant in the encoder would make the two
    // halves diverge for exactly the re-pin ProgramPin.bytes exists to survive.
    it('encodes against a program of a historical length, matching what a pin can validate', () => {
      const { tokens, minOut, recipient } = SETTLE_VECTORS[0]!;
      const longerProgram = (SETTLE_PROGRAM + 'ab'.repeat(9)) as Hex;
      const encoded = encodeSettleProgram(tokens, minOut, recipient, longerProgram);
      const decoded = validateSettleProgram(encoded, [{ hash: keccak256(longerProgram), bytes: SETTLE_WIRE.PROGRAM_BYTES + 9 }]);

      expect(decoded.minOut).toBe(minOut);
      expect(BigInt(decoded.recipient)).toBe(BigInt(recipient));
    });
  });

  describe('the program half', () => {
    it('rejects a payload shorter than the program', () => {
      expectCode(() => decodeSettleProgram(SETTLE_PROGRAM.slice(0, -2) as Hex), 'PROGRAM_TRUNCATED');
    });

    it('rejects a payload with no argument tail at all', () => {
      expectCode(() => decodeSettleProgram(SETTLE_PROGRAM), 'ARGS_TRUNCATED');
    });

    it('decodeSettleProgram accepts ANY 391 bytes — it pins length, not identity', () => {
      // The structural tier deliberately says nothing about what the program does. This is the gap
      // validateSettleProgram closes, and the reason intent.ts identifies by hash.
      const impostor = ('0x' + 'ee'.repeat(SETTLE_WIRE.PROGRAM_BYTES) + SETTLE_VECTORS[0]!.args.slice(2)) as Hex;
      expect(decodeSettleProgram(impostor).minOut).toBe(0n);
      expectCode(() => validateSettleProgram(impostor), 'PROGRAM_HASH');
    });

    it('validateSettleProgram rejects a single flipped program byte', () => {
      const flipped = (SETTLE_PROGRAM.slice(0, 100) + (SETTLE_PROGRAM[100] === '0' ? '1' : '0') + SETTLE_PROGRAM.slice(101) + SETTLE_VECTORS[0]!.args.slice(2)) as Hex;
      expectCode(() => validateSettleProgram(flipped), 'PROGRAM_HASH');
    });
  });

  describe('encodeSettleProgram', () => {
    const { tokens, minOut, recipient } = SETTLE_VECTORS[0]!;

    it('refuses an empty token list', () => {
      expect(() => encodeSettleProgram([], minOut, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a zero recipient', () => {
      expect(() => encodeSettleProgram(tokens, minOut, 0n, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a token that does not fit in 20 bytes', () => {
      expect(() => encodeSettleProgram([(1n << 161n)], minOut, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    // A negative bigint clears BOTH `> ADDRESS_MASK` and `=== 0n`, and the encoder's write loop
    // terminates on `value > 0n` before writing a byte — so before the guard, `-1n` encoded as an
    // all-zero word: a recipient that defeats the nonzero check, or a token that sweeps address(0).
    it('refuses a negative recipient rather than encoding address(0)', () => {
      expect(() => encodeSettleProgram(tokens, minOut, -1n, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a negative token rather than encoding address(0)', () => {
      expect(() => encodeSettleProgram([-1n], minOut, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a minOut outside uint256', () => {
      expect(() => encodeSettleProgram(tokens, 1n << 256n, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
      expect(() => encodeSettleProgram(tokens, -1n, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    // The program's LENGTH is the caller's now, not the current constant -- that is what lets a
    // historical pin be encoded against (see the ProgramPin test above). A wrong program is still
    // caught, but at validate, where the hash is the thing that decides.
    it('takes the program length from programHex, and a wrong program fails at validation', () => {
      expect(() => encodeSettleProgram(tokens, minOut, recipient, '0x' as Hex)).toThrow(RangeError);

      const encoded = encodeSettleProgram(tokens, minOut, recipient, '0xdead' as Hex);
      expectCode(() => validateSettleProgram(encoded), 'PROGRAM_TRUNCATED');
    });

    it('refuses an address that is short by a character rather than left-padding it', () => {
      // 39 nibbles: a transcription slip. Left-padding would silently encode a DIFFERENT address,
      // and this is the encoder behind the recommended encode-and-compare path.
      const short = '0x833589fcd6edb6e08f4c7c32d4f71b54bda0291' as Hex;
      expect(() => encodeSettleProgram([short], minOut, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
      expect(() => encodeSettleProgram(tokens, minOut, short, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('settlePayload refuses a tail that is not canonical 0x hex', () => {
      // Exported from ./verify, so an unprefixed tail would lose its first byte to the slice and
      // resurface as a puzzling ARGS_TRUNCATED rather than a clear rejection.
      for (const bad of ['', '0x1', '0Xdead', 'dead', '0xzz']) {
        expect(() => settlePayload(bad as Hex)).toThrow(RangeError);
      }
      expect(() => settlePayload(SETTLE_VECTORS[0]!.args)).not.toThrow();
    });

    it('refuses a minOut that is not a bigint as RangeError, not TypeError', () => {
      // A caller deserializing minOut from JSON gets a number; the word-write loop would otherwise
      // raise TypeError from a BigInt mix, breaking the RangeError contract every other input keeps.
      expect(() => encodeSettleProgram(tokens, 1000 as unknown as bigint, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a recipient above the 20-byte range', () => {
      expect(() => encodeSettleProgram(tokens, minOut, 1n << 161n, SETTLE_PROGRAM)).toThrow(RangeError);
    });

    it('refuses a programHex that is not valid hex', () => {
      expect(() => encodeSettleProgram(tokens, minOut, recipient, '0xzz' as Hex)).toThrow(RangeError);
    });

    // `BigInt('')` is `0n`, not a throw, so an empty string would have encoded as address(0) and
    // swept it. Malformed hex raised SyntaxError, where every other rejection here is a RangeError.
    it('refuses an empty or malformed address string as RangeError, not address(0)', () => {
      for (const bad of ['', '0x', '0xzz', '0x42..', '833589fcd6edb6e08f4c7c32d4f71b54bda02913']) {
        expect(() => encodeSettleProgram([bad as Hex], minOut, recipient, SETTLE_PROGRAM)).toThrow(RangeError);
        expect(() => encodeSettleProgram(tokens, minOut, bad as Hex, SETTLE_PROGRAM)).toThrow(RangeError);
      }
    });
  });

  describe('never throws', () => {
    it('parseSettleProgram reports malformed input instead of throwing', () => {
      for (const bad of ['', '0x', '0xzz', '0x1', SETTLE_PROGRAM] as Hex[]) {
        expect(() => parseSettleProgram(bad)).not.toThrow();
        expect(parseSettleProgram(bad).fatal).not.toBeNull();
      }
    });

    it('an absurd token count is reported, never allocated against', () => {
      // The count is a full uint256 on the wire, so a hostile payload can claim 2^255 elements. It
      // must be measured against the bytes actually present, not turned into a length.
      const absurd = ('0x' + (96n).toString(16).padStart(64, '0') + '0'.repeat(64) + '11'.repeat(32) + 'ff'.repeat(32)) as Hex;
      const parse = parseSettleProgram(settlePayload(absurd));
      expect(parse.fatal?.code).toBe('ARGS_TRUNCATED');
      expect(parse.tokenWords).toEqual([]);
    });
  });

  describe('closure', () => {
    it('SETTLE_WIRE exposes the wire constants a foreign implementer needs', () => {
      expect(SETTLE_WIRE.PROGRAM_BYTES).toBe(391);
      expect(SETTLE_WIRE.WORD_BYTES).toBe(32);
      expect(SETTLE_WIRE.ADDRESS_BYTES).toBe(20);
      expect(SETTLE_WIRE.HEAD_SLOTS).toBe(3);
      expect(SETTLE_WIRE.HEAD_BYTES).toBe(96);
      expect(SETTLE_WIRE.PROGRAM_HASH).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});

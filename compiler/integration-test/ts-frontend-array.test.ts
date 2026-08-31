import { cook } from './utils.js';

// Real-EVM proof for the "Local `new Array(n)` construction folding" ts-frontend pass
// (compiler/src/ts-frontend.ts): the unit tests in test/ts-frontend.test.ts prove the compiled
// bytecode SHAPE (no NEW_ARRAY/SET_INDEX/INDEX opcodes remain); these prove the compiled
// bytecode's VALUE, by actually executing it via cook() against a real deployed engine on
// anvil — the area at real risk here is slot/frame allocation (deleting a `new Array`
// declaration changes v1 ALLOCATE counts), not just "does it parse".
describe('integration: local new Array(n) construction folding (ts-frontend)', () => {
  it('the motivating probe: unrolled-loop construction + a read returns the correct value', () => {
    const source = `
      function main(): Uint256 {
        const arr = new Array(3);
        for (let i = 0n; i < 3n; i++) {
          arr[i] = i * 2n;
        }
        return arr[1];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(2n);
  });

  it('a plain-number counter unroll (the synthesized-NumericLiteral fallback) returns the correct value', () => {
    const source = `
      function main() {
        const arr = new Array(3);
        for (let i = 0; i < 3; i++) {
          arr[i] = i * 2;
        }
        return arr[1];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(2n);
  });

  it('the `while`-counting idiom construction returns the correct value', () => {
    const source = `
      function main() {
        const arr = new Array(3);
        let i = 0n;
        while (i < 3n) { arr[i] = i * 10n; i++; }
        return arr[2];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(20n);
  });

  it('an accumulator loop over a folded array (fed into the LOCAL scalar pass) returns the correct sum', () => {
    const source = `
      function main() {
        const fees = new Array(3);
        fees[0] = 100n;
        fees[1] = 500n;
        fees[2] = 3000n;
        let total = 0n;
        for (let i = 0n; i < 3n; i++) { total += fees[i]; }
        return total;
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(3600n);
  });

  it('out-of-order writes return the correct sum', () => {
    const source = `
      function main() {
        const arr = new Array(3);
        arr[2] = 30n;
        arr[0] = 10n;
        arr[1] = 20n;
        return arr[0] + arr[1] + arr[2];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(60n);
  });

  it('two independent arrays, constructions INTERLEAVED, both return the correct sum', () => {
    const source = `
      function main() {
        const a = new Array(2);
        const b = new Array(2);
        a[0] = 1n;
        b[0] = 10n;
        a[1] = 2n;
        b[1] = 20n;
        return a[0] + a[1] + b[0] + b[1];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(33n);
  });

  it('a read index via a top-level const returns the correct value', () => {
    const source = `
      const K = 1n;
      function main() {
        const arr = new Array(3);
        arr[0] = 10n;
        arr[1] = 20n;
        arr[2] = 30n;
        return arr[K];
      }
    `;

    expect(BigInt(cook(source, { tsSource: true }))).toBe(20n);
  });

  // Equivalence harness: for both a FOLDING fixture and a DECLINING fixture, the identical
  // source must return the SAME value whether compiled through the ts-frontend (tsSource:
  // true, this feature folds it away entirely) or through plain acorn (no tsSource — this
  // feature never runs, the array stays a real runtime NEW_ARRAY/SET_INDEX/INDEX heap
  // allocation) — proving a decline path never silently changes the executed VALUE, and a
  // fold never changes it either, only the bytecode shape.
  //
  // NOTE (UPDATED — see CLAUDE.md's "Same-file user-function return-kind inference" note):
  // an aliasing fixture (`const b = arr;`) and a helper-return fixture (`let x = helper();
  // x[0] = 5n; return x[0];`) were originally tried here and DROPPED, because both reverted
  // at real EVM execution regardless of tsSource — a compile-time-VARIABLE-KIND-inference
  // gap in the base (core-acorn-stack) compiler, wholly unrelated to this ts-frontend-only
  // fold feature (this pass never touches either fixture — the identical revert with
  // tsSource on AND off was the proof). That gap is now FIXED (a separate change, gated on
  // neither `tsSource` nor this file's own fold feature): `inferKindWithContext`
  // (processor/inference.ts) now infers a plain `Identifier` read against the SOURCE
  // variable's own tracked kind (fixing aliasing), and a same-file function call against a
  // fixpoint-analyzed `analyzeFunctionReturnKinds` map (processor/return-kind.ts, fixing the
  // helper-return shape) instead of always defaulting to `scalar`. Both shapes — including
  // the exact `helper()`-mutate/read-only pair once documented broken here — are now covered,
  // with real EVM execution proof, in `integration-test/function-return-kind.test.ts`; this
  // file is left AS IS below (still exercising ts-frontend-only fold/decline behavior, which
  // is unaffected either way) rather than duplicating that coverage here.
  //
  // STILL BROKEN, deliberately NOT fixed by the same change (a third, distinct instance of
  // the same failure family — see `integration-test/function-return-kind.test.ts`'s own
  // "KNOWN GAP" test and CLAUDE.md): a call-ARGUMENT fixture (`helper(arr)`, passing an
  // existing dynamic local INTO a same-file function) still reverts
  // `SauceInvalidOperationArgs(INDEX)` regardless of tsSource — the callee's own parameter is
  // always inferred `scalar` with no per-call-site reasoning, and v1's engine additionally
  // splits a dynamic argument into a separate heap-argument index space the compiler doesn't
  // account for. Tracked, not silently missed; out of scope for this fix.
  //
  // The return-escape fold below (`scanArrayUses` Rule 6b, ts-frontend.ts) remains the ONLY
  // way `main()`'s own bare `return arr;` (built directly inside `main`, not via a helper) is
  // turned into the well-defined `uint256[N]` wire encoding — that fold is unrelated to (and
  // unaffected by) the return-kind inference fix above, and still applies only to a
  // provably-fully-constant array built directly in `main`'s own body.
  describe('equivalence: cook(tsSource) === cook(plain), fold and decline alike', () => {
    const fixtures: Record<string, string> = {
      'folds (straight-line writes)': `
        function main() {
          const a = new Array(2);
          a[0] = 5n;
          a[1] = 7n;
          return a[1];
        }
      `,
      'folds (accumulator via unrolled loop)': `
        function main() {
          const fees = new Array(3);
          fees[0] = 100n;
          fees[1] = 500n;
          fees[2] = 3000n;
          let total = 0n;
          for (let i = 0n; i < 3n; i++) { total += fees[i]; }
          return total;
        }
      `,
      'declines (partial writes — a hole)': `
        function main() {
          const arr = new Array(3);
          arr[0] = 1n;
          arr[1] = 2n;
          return arr[0] + arr[1];
        }
      `,
      'declines (non-constant read index)': `
        function main(n: Uint256) {
          const arr = new Array(3);
          arr[0] = 10n;
          arr[1] = 20n;
          arr[2] = 30n;
          return arr[n];
        }
      `,
      'declines (rebinding)': `
        function main() {
          let arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          arr = new Array(2);
          arr[0] = 9n;
          arr[1] = 9n;
          return arr[0] + arr[1];
        }
      `,
    };

    for (const [label, source] of Object.entries(fixtures)) {
      it(label, () => {
        const args = source.includes('main(n') ? [1n] : [];
        const folded = cook(source, { tsSource: true, args });
        const plain = cook(source.replace(/: Uint256/g, ''), { args });

        expect(folded).toBe(plain);
      });
    }
  });

  // ── return-escape fold: `return arr;` in main() → literal array (real EVM proof) ──
  //
  // Unlike every fixture above (none of which ever return the bare array identifier — that
  // shape was, until this branch, a DECLINE case), these prove the ts-frontend's NEW `return
  // arr;` return-escape fold (`scanArrayUses` Rule 6b, gated to a top-level `function main`
  // only — ts-frontend.ts) executes correctly end to end: the folded program's `cook()` output
  // is the real, well-defined `uint256[N]` wire encoding (three 32-byte words for `[0, 2, 4]`),
  // not the raw Solidity MEMORY ADDRESS leak a `new Array(n)`-built TUPLE return produces today
  // (see the negative-control test below, and this file's own top-of-section doc comment).
  describe('return-escape fold: `return arr;` in main() (real EVM execution)', () => {
    const word = (n: bigint): string => n.toString(16).padStart(64, '0');
    const words = (hex: string): bigint[] =>
      hex
        .slice(2)
        .match(/.{1,64}/g)!
        .map((w) => BigInt('0x' + w));

    it('the motivating probe: an unrolled-loop construction + `return arr;` returns the real 96-byte word form (uint256[3])', () => {
      const source = `
        function main(): Uint256 {
          const arr = new Array(3);
          for (let i = 0n; i < 3n; i++) {
            arr[i] = i * 2n;
          }
          return arr;
        }
      `;

      expect(cook(source, { tsSource: true })).toBe('0x' + word(0n) + word(2n) + word(4n));
    });

    it('the straight-line-writes spelling returns the IDENTICAL bytes as the unrolled-loop spelling', () => {
      const unrolled = `
        function main() {
          const arr = new Array(3);
          for (let i = 0n; i < 3n; i++) { arr[i] = i * 2n; }
          return arr;
        }
      `;
      const straightLine = `
        function main() {
          const arr = new Array(3);
          arr[0] = 0n;
          arr[1] = 2n;
          arr[2] = 4n;
          return arr;
        }
      `;

      expect(cook(unrolled, { tsSource: true })).toBe(cook(straightLine, { tsSource: true }));
    });

    it('a full-range element (2**256 - 1) survives intact, and cook() matches a hand-written literal of the SAME element width', () => {
      const big = (1n << 256n) - 1n;
      const folded = `
        function main() {
          const arr = new Array(2);
          arr[0] = ${big}n;
          arr[1] = 1n;
          return arr;
        }
      `;
      // A hand-written literal with the SAME element magnitudes naturally encodes at width 32
      // too (`maxByteWidth` already selects 32 for a value this large, with NO forcing
      // involved) — so this is a genuine apples-to-apples "same element width" comparison,
      // exercising the required proof (`cook()` on the folded program === `cook()` on the
      // equivalent hand-written `return [lit0, ...]`) without depending on the forcing
      // mechanism at all.
      const literal = `function main() { return [${big}n, 1n]; }`;

      const foldedOut = cook(folded, { tsSource: true });
      const literalOut = cook(literal, {});

      expect(foldedOut).toBe('0x' + word(big) + word(1n));
      expect(foldedOut).toBe(literalOut);
    });

    // NEGATIVE CONTROL, deliberately NOT folded into the "equivalence: cook(tsSource) ===
    // cook(plain)" describe above — for `return arr;` specifically, the two paths now
    // legitimately DIFFER, which is the entire point of this feature (finding #1 in the task
    // brief, confirmed here again independently via real EVM execution rather than trusted from
    // the design brief): the PLAIN path leaks raw Solidity memory addresses (960/1152/1344
    // decimal — meaningless, and not any documented encoding), while the FOLDED path returns the
    // real, well-defined uint256[3] word encoding (0, 2, 4).
    it('plain (no tsSource) vs folded (tsSource) DIFFER for `return arr;` — the plain path leaks raw memory pointers, the folded path returns real values', () => {
      const source = `
        function main() {
          const arr = new Array(3);
          arr[0] = 0n;
          arr[1] = 2n;
          arr[2] = 4n;
          return arr;
        }
      `;
      const plain = cook(source, {});
      const folded = cook(source, { tsSource: true });

      expect(plain).not.toBe(folded);

      // The plain path's three words decode to 960/1152/1344 — NOT 0/2/4, and not any
      // documented encoding: raw per-element Solidity memory addresses allocated during that
      // call, discarded the instant `cook()` returns (v1's `execute()` returns a TUPLE's
      // `.data` verbatim; `DynamicData.sol` documents it as "an array of Dynamic pointers", not
      // values).
      expect(words(plain)).toEqual([960n, 1152n, 1344n]);

      // The folded path's three words decode to the real values — exactly ABI-decodable as
      // uint256[3].
      expect(words(folded)).toEqual([0n, 2n, 4n]);
    });
  });
});

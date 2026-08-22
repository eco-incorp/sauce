import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

/**
 * §1.5 — annotation-driven storage kind + heuristic cross-check.
 *
 * A SauceScript author may ANNOTATE a variable's storage kind with a real TS type on the
 * `.ts`/`.sauce.ts` (ts-frontend) path — `let xs: uint256[] = …` (dynamic/heap) or
 * `let x: Uint256 = …` (scalar). The ts-frontend captures the annotation BEFORE it strips
 * types for acorn (annotations survive out-of-band, keyed by name, the same channel shape
 * `wideReturnArrays` uses), and `storeExpression` cross-checks it against the compiler's own
 * heuristic inference (`inferKindWithContext`):
 *
 *   - AGREE            → use the kind (byte-identical to the unannotated source).
 *   - annotate DYNAMIC, heuristic inferred SCALAR → the SAFE direction (a heap slot round-trips
 *     a scalar losslessly on v1, and it is exactly the K-bug fix for a genuinely dynamic value
 *     the heuristic under-inferred). Honor the annotation → dynamic/heap storage.
 *   - annotate SCALAR, heuristic inferred DYNAMIC → the UNSAFE direction (a v1 scalar slot drops
 *     the descriptor — the K-bug failure mode). Rejected at compile time.
 *
 * The storage-kind vocabulary mirrors the RS oracle's own annotation split
 * (`annotation_ty`/`type_by_name`, compiler-rs crates/sauce-core/src/lower/mod.rs): bytes,
 * string, `T[]`, and an inline object type `{…}` are dynamic; Uint256/Address/Account/bool and
 * the TS keyword aliases number/bigint/boolean are scalar.
 */
describe('§1.5 annotation-driven storage kind', () => {
  describe('agreement — byte-identical to the unannotated source', () => {
    it('a dynamic annotation on a helper() array return AGREES with the heuristic', () => {
      const src = (annotation: string) => `
        function helper() {
          const arr = new Array(2);
          arr[0] = 1n;
          arr[1] = 2n;
          return arr;
        }
        function main() {
          let arr${annotation} = helper();
          return arr[0] + arr[1] * 10n;
        }
      `;

      const annotated = compile(src(': Uint256[]'), { tsSource: true });
      const bare = compile(src(''), { tsSource: true });

      expect(Array.from(annotated.bytecode[0])).toEqual(Array.from(bare.bytecode[0]));
    });

    it('a scalar annotation on a scalar literal AGREES (WRITE_VALUE, byte-identical)', () => {
      const annotated = compile('function main() { let x: Uint256 = 5n; return x; }', { tsSource: true });
      const bare = compile('function main() { let x = 5n; return x; }', { tsSource: true });

      expect(Array.from(annotated.bytecode[0])).toEqual(Array.from(bare.bytecode[0]));
      // and it really is a scalar (VALUE) store, not a heap one
      expect(Array.from(annotated.bytecode[0])).toContain(OPS.WRITE_VALUE);
      expect(Array.from(annotated.bytecode[0])).not.toContain(OPS.WRITE_HEAP);
    });
  });

  describe('safe-direction override — annotation promotes a heuristic scalar to dynamic/heap', () => {
    it('a dynamic annotation forces HEAP storage where the heuristic would pick a scalar slot', () => {
      // A bare (unannotated) alias of a scalar-tagged binding infers `scalar`; the dynamic
      // annotation promotes the store to a heap slot (WRITE_HEAP), the safe K-bug direction.
      const annotated = compile('function main() { let a = 5n; let b: Uint256[] = a; return b; }', {
        tsSource: true,
      });
      const bare = compile('function main() { let a = 5n; let b = a; return b; }', { tsSource: true });

      expect(Array.from(annotated.bytecode[0])).toContain(OPS.WRITE_HEAP);
      // the unannotated form stays a scalar store — proving the annotation is what changed it
      expect(Array.from(bare.bytecode[0])).not.toContain(OPS.WRITE_HEAP);
    });
  });

  describe('unsafe-direction disagreement — rejected at compile time (the K-bug it catches)', () => {
    it('rejects a scalar annotation on a genuinely dynamic (new Array) initializer', () => {
      expect(() =>
        compile('function main() { let x: Uint256 = new Array(3); return x[0]; }', { tsSource: true }),
      ).toThrow(/annotated as a scalar type/);
    });

    it('rejects a scalar annotation on an array literal', () => {
      expect(() => compile('function main() { let x: Uint256 = [1n, 2n]; return x[0]; }', { tsSource: true })).toThrow(
        /annotated as a scalar type/,
      );
    });
  });

  describe('opt-in and safety', () => {
    it('leaves an unrecognized TS type annotation untouched (byte-identical, no error)', () => {
      const annotated = compile('function main() { let x: SomeUserType = 5n; return x; }', { tsSource: true });
      const bare = compile('function main() { let x = 5n; return x; }', { tsSource: true });

      expect(Array.from(annotated.bytecode[0])).toEqual(Array.from(bare.bytecode[0]));
    });

    it('does not act on an ambiguous name (annotated in one scope, unannotated in another)', () => {
      // `v` is annotated dynamic in `helper` but declared bare (scalar) in `main`. The name is
      // ambiguous across scopes, so the annotation must NOT bleed into main() and wrongly reject
      // (or override) its own unrelated `let v = 5n`.
      expect(() =>
        compile(
          `
          function helper() {
            let v: Uint256[] = new Array(1);
            v[0] = 7n;
            return v;
          }
          function main() {
            let v = 5n;
            return v + helper()[0];
          }
        `,
          { tsSource: true },
        ),
      ).not.toThrow();
    });

    it('annotations are inert on the plain (non-tsSource) path', () => {
      // acorn cannot parse a TS type annotation, so an annotated source is a syntax error on the
      // plain path — proving annotations are a ts-frontend-only, opt-in feature.
      expect(() => compile('function main() { let x: Uint256 = 5n; return x; }')).toThrow();
    });
  });
});

/**
 * Layer-C plugin manifest (`sdk/src/plugin/manifest.json`) — the single declarative source of
 * truth for the shared stdlib/DSL plugin (see docs/plans/P5-plugin-skeleton-design.md). No
 * behavior change yet: this pins the manifest's own shape, and separately proves its
 * `nameParity` map can't silently drift from the surface the compiler actually implements.
 *
 * `nameParity` documents a SauceScript SURFACE name (the keyword/global a caller writes) mapped
 * to the underlying engine opcode name it lowers to — so it only carries rows where the two
 * DIVERGE. Checked two ways, so either direction of drift fails: the surface still COMPILES (a
 * rename or removal is what the manifest would be lying about), and it still emits the opcode
 * VALUE the row names. The published compiler exports no opcode table, so that value is declared
 * here — the same posture as `sdk/src/verify/wire.ts`'s `SETTLE_WIRE`, and measured the same way,
 * against the compiler's actual emission.
 */
import { loadPlugin } from '../../src/plugin/index.js';
import { compileProgram as compile } from '../helpers';

// The compiler's two REAL backends. `'v1'`/`'v12'` were the retired TS compiler's EVM targets and
// both map to `'evm'` now, so iterating them ran every case twice against one backend.
const TARGETS = ['evm', 'svm'] as const;

/** The engine's REVERT opcode — measured against the published compiler's emission for `throw`,
 *  the same way `SETTLE_WIRE`'s constants are. Identical on both EVM and SVM. */
const REVERT_OP = 0xb6;

describe('plugin manifest (Layer C)', () => {
  // Empty, and an entry is not free to add: the SDK's route path (`routes/ambient.ts#chainAmbient`)
  // hands this list to EVERY `openRoute` compile, and the RS compiler resolves a bare specifier by
  // walking up from the caller's `baseDirs` — which `openRoute` does not supply. `@sauce/token`
  // lives at `sdk/src/std/token/` and is installed into no node_modules tree, so declaring it here
  // makes every route throw `failed to import module "@sauce/token"`. It belongs here once the SDK
  // resolves its own stdlib on the route path.
  it('declares no ambient module — none resolves on the route path yet', () => {
    expect(loadPlugin().ambient).toEqual([]);
  });

  describe('nameParity matches what the compiler actually implements', () => {
    // Counting is control-vs-test rather than a bare `.toContain`: a single-byte opcode value
    // can appear as an incidental operand byte (a literal chunk, a selector, another op's
    // immediate) even in a program that doesn't use the surface at all. Compare the count in
    // the test program against a control that shouldn't invoke the surface — the surface must
    // introduce STRICTLY more of the opcode byte than the control does.
    const countByte = (buf: Uint8Array, b: number): number => {
      let n = 0;
      for (const x of buf) if (x === b) n++;
      return n;
    };

    it.each(TARGETS)('`throw` lowers to the REVERT opcode on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.throw.toUpperCase()).toBe('REVERT');

      const { bytecode: control } = compile('function main(): Uint256 { return 1n; }', { target });
      const { bytecode: test } = compile('function main(): void { throw "nope"; }', { target });

      expect(countByte(test[0]!, REVERT_OP)).toBeGreaterThan(countByte(control[0]!, REVERT_OP));
    });

    it.each(TARGETS)('`log` is a surface in its own right, so the map carries no row for it (%s)', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.emit).toBeUndefined();
      const amount = 'const n = 500n;';
      expect(
        compile(`function main(): void { ${amount} log(n.toBytesBe(32)); }`, { target }).bytecode[0]!.length,
      ).toBeGreaterThan(0);
    });
  });
});

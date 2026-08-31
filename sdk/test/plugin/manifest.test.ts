/**
 * Layer-C plugin manifest (`sdk/src/plugin/manifest.json`) — the single declarative source of
 * truth for the shared stdlib/DSL plugin (see docs/plans/P5-plugin-skeleton-design.md). No
 * behavior change yet: this pins the manifest's own shape, and separately proves its
 * `nameParity` map can't silently drift from what the LOCAL TypeScript compiler
 * (`@eco-incorp/sauce-compiler`, this repo's `compiler/` workspace) actually implements.
 *
 * `nameParity` documents a SauceScript SURFACE name (the keyword/global a caller writes) mapped
 * to the underlying engine opcode name it lowers to. Checked two ways so either direction of
 * drift fails: (a) the opcode NAME the manifest names (case-insensitively — the manifest spells
 * it lowercase, `compiler/src/saucer/ops.ts` spells the opcode key uppercase) still exists in the
 * real opcode table, so renaming/removing the opcode fails this test; and (b) compiling the
 * corresponding SauceScript surface actually emits that opcode's numeric value, so retargeting
 * `emit`/`throw` to a DIFFERENT opcode without updating the manifest also fails this test.
 */
import { compile, OPS, type CompileTarget } from '@eco-incorp/sauce-compiler';
import { loadPlugin } from '../../src/plugin/index.js';

const TARGETS: readonly CompileTarget[] = ['v1', 'v12'];

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

    it.each(TARGETS)('emit(...) lowers to the LOG opcode on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.emit.toUpperCase()).toBe('LOG');
      expect(OPS.LOG).toBeDefined();

      const { bytecode: control } = compile('function main() { return 1n; }', { target, cache: false });
      const { bytecode: test } = compile('function main() { emit("Ping()"); }', { target, cache: false });

      expect(countByte(test[0], OPS.LOG)).toBeGreaterThan(countByte(control[0], OPS.LOG));
    });

    it.each(TARGETS)('throw lowers to the REVERT opcode on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.throw.toUpperCase()).toBe('REVERT');
      expect(OPS.REVERT).toBeDefined();

      const { bytecode: control } = compile('function main() { return 1n; }', { target, cache: false });
      const { bytecode: test } = compile('function main() { throw 1n; }', { target, cache: false });

      expect(countByte(test[0], OPS.REVERT)).toBeGreaterThan(countByte(control[0], OPS.REVERT));
    });
  });
});

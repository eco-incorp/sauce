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
  it('declares @sauce/token as the ambient module list', () => {
    expect(loadPlugin().ambient).toEqual(['@sauce/token']);
  });

  describe('nameParity matches what the compiler actually implements', () => {
    it.each(TARGETS)('emit(...) lowers to the LOG opcode on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.emit.toUpperCase()).toBe('LOG');
      expect(OPS.LOG).toBeDefined();

      const { bytecode } = compile('function main() { emit("Ping()"); }', { target, cache: false });

      expect(Array.from(bytecode[0])).toContain(OPS.LOG);
    });

    it.each(TARGETS)('throw lowers to the REVERT opcode on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.throw.toUpperCase()).toBe('REVERT');
      expect(OPS.REVERT).toBeDefined();

      const { bytecode } = compile('function main() { throw 1n; }', { target, cache: false });

      expect(Array.from(bytecode[0])).toContain(OPS.REVERT);
    });
  });
});

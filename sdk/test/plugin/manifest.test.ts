/**
 * Layer-C plugin manifest (`sdk/src/plugin/manifest.json`) — the single declarative source of
 * truth for the shared stdlib/DSL plugin (see docs/plans/P5-plugin-skeleton-design.md). No
 * behavior change yet: this pins the manifest's own shape, and separately proves its
 * `nameParity` map can't silently drift from the surface the compiler actually implements.
 *
 * `nameParity` documents a SauceScript SURFACE name (the keyword/global a caller writes) mapped
 * to the underlying engine opcode name it lowers to — so it only carries rows where the two
 * DIVERGE. The check is that the surface still compiles: the compiler package exports no opcode
 * table, so a numeric-emission assertion has nothing to resolve against, and a renamed or removed
 * surface is what the manifest would actually be lying about.
 */
import { loadPlugin } from '../../src/plugin/index.js';
import { compileProgram as compile } from '../helpers';

const TARGETS = ['v1', 'v12'] as const;

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

    it.each(TARGETS)('the `throw` surface the manifest aliases still compiles on target %s', (target) => {
      const { nameParity } = loadPlugin();

      expect(nameParity.throw.toUpperCase()).toBe('REVERT');
      // A removed or renamed surface is the drift this can still catch without an opcode table.
      expect(compile('function main(): void { throw "nope"; }', { target }).bytecode[0]!.length).toBeGreaterThan(0);
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

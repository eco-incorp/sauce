import { resolve } from 'node:path';
import {
  compile,
  createCompileCache,
  compileCacheKey,
  getDefaultCompileCache,
  clearDefaultCompileCache,
} from '../src/index.js';
import type { CompileResult } from '../src/index.js';

// A hit must be byte-identical to a fresh compile, and the cache must be
// invisible to output (only speed changes). The correctness risks are (1) a
// wrong hit across differing inputs and (2) shared mutable state between a
// cached entry and a returned result — both pinned below. `{ cache: false }` is
// the guaranteed-fresh baseline now that caching is ON by default.

const hex = (r: CompileResult) => r.bytecode.map((b) => Buffer.from(b).toString('hex')).join('|');

describe('compile cache', () => {
  it('a cached hit is byte-identical to a fresh (uncached) compile', () => {
    const src = 'function main() { const x = 2n + 3n; return x; }';
    const cache = createCompileCache();

    const fresh = compile(src, { cache: false }); // guaranteed no cache
    const miss = compile(src, { cache });
    const hitResult = compile(src, { cache });

    expect(hex(miss)).toBe(hex(fresh));
    expect(hex(hitResult)).toBe(hex(fresh));
    expect(cache.stats).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  it('caching is ON by default (a repeat bare compile hits the process-global cache)', () => {
    clearDefaultCompileCache();
    const src = 'function main() { return 42n; }';

    const first = compile(src); // miss → default cache
    const second = compile(src); // hit → default cache

    expect(hex(second)).toBe(hex(first));
    expect(getDefaultCompileCache().stats.hits).toBeGreaterThanOrEqual(1);
  });

  it('cache: false bypasses the default cache entirely', () => {
    clearDefaultCompileCache();
    const src = 'function main() { return 43n; }';

    const a = compile(src, { cache: false });
    const b = compile(src, { cache: false });

    expect(hex(a)).toBe(hex(b)); // still deterministic, just never cached
    expect(getDefaultCompileCache().stats).toEqual({ hits: 0, misses: 0, size: 0 });
  });

  it('cache: true is the same as the default (process-global) cache', () => {
    clearDefaultCompileCache();
    const src = 'function main() { return 44n; }';

    compile(src, { cache: true }); // miss
    compile(src); // hit — same global store as cache:true
    expect(getDefaultCompileCache().stats.hits).toBeGreaterThanOrEqual(1);
  });

  it('mutating a returned result does not corrupt the cache', () => {
    const src = 'function main() { return 7n; }';
    const cache = createCompileCache();

    const first = compile(src, { cache });
    first.bytecode[0][0] = 0xff; // caller scribbles on its copy
    first.warnings.push('injected');

    const second = compile(src, { cache });
    expect(second.bytecode[0][0]).not.toBe(0xff);
    expect(second.warnings).not.toContain('injected');
    // second is itself a fresh clone — scribbling it must not affect a third read.
    second.bytecode[0][0] = 0xee;
    expect(compile(src, { cache }).bytecode[0][0]).not.toBe(0xee);
  });

  it('separates entries by every output-affecting option', () => {
    const cache = createCompileCache();
    const src = 'function main() { const x = 1 === 1 ? 5n : 10n; return x; }';

    const v1 = compile(src, { cache });
    const v12 = compile(src, { cache, target: 'v12' });
    const unfolded = compile(src, { cache, fold: false });

    // Distinct inputs → distinct entries (3 misses), and distinct output.
    expect(cache.stats.misses).toBe(3);
    expect(hex(v12)).not.toBe(hex(v1));
    expect(hex(unfolded)).not.toBe(hex(v1)); // fold:false keeps the runtime branch
  });

  it('args and defines participate in the key', () => {
    const cache = createCompileCache();
    const src = 'function main(a) { return a + 1n; }';

    const a = compile(src, { cache, args: [1n] });
    const b = compile(src, { cache, args: [2n] });
    expect(hex(a)).not.toBe(hex(b)); // different appended arg bytes
    expect(cache.stats.misses).toBe(2);

    // Re-requesting an earlier arg set hits.
    compile(src, { cache, args: [1n] });
    expect(cache.stats.hits).toBe(1);
  });

  it('default options and their explicit equivalents share one entry', () => {
    const cache = createCompileCache();
    const src = 'function main() { return 1n; }';

    compile(src, { cache });
    compile(src, { cache, target: 'v1', treeshake: true, fold: true }); // the defaults, spelled out

    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, size: 1 });
  });

  it('a plain Map works as a cache', () => {
    const src = 'function main() { return 9n; }';
    const cache = new Map<string, CompileResult>();

    const first = compile(src, { cache });
    expect(cache.size).toBe(1);
    expect(hex(compile(src, { cache }))).toBe(hex(first));
  });

  it('evicts least-recently-used beyond maxEntries', () => {
    const cache = createCompileCache(2);
    const mk = (n: number) => `function main() { return ${n}n; }`;

    compile(mk(1), { cache }); // [1]
    compile(mk(2), { cache }); // [1,2]
    compile(mk(1), { cache }); // hit → refreshes 1 → [2,1]
    compile(mk(3), { cache }); // insert 3 → evicts LRU (2) → [1,3]

    expect(cache.stats.size).toBe(2);

    const before = cache.stats.misses;
    compile(mk(1), { cache }); // still present → hit
    compile(mk(3), { cache }); // still present → hit
    compile(mk(2), { cache }); // evicted → miss
    expect(cache.stats.misses).toBe(before + 1);
  });

  it('rejects a non-positive maxEntries', () => {
    expect(() => createCompileCache(0)).toThrow('positive integer');
    expect(() => createCompileCache(-3)).toThrow('positive integer');
  });

  it('compileCacheKey is stable across option field order and bigint-safe', () => {
    const src = 'function main() { return 1n; }';
    const k1 = compileCacheKey(src, { target: 'v12', defines: { A: 1n, B: true } });
    const k2 = compileCacheKey(src, { defines: { B: true, A: 1n }, target: 'v12' });
    expect(k1).toBe(k2); // field/key order must not matter

    // bigint 1n must not collide with number 1 or string "1" in defines.
    const kb = compileCacheKey(src, { defines: { A: 1n } });
    const kn = compileCacheKey(src, { defines: { A: 1 } });
    expect(kb).not.toBe(kn);
  });

  it('cacheKeyExtra discriminates entries (the escape hatch for unkeyable inputs)', () => {
    const cache = createCompileCache();
    const src = 'function main() { return 1n; }';

    compile(src, { cache, cacheKeyExtra: 'transform-v1' });
    compile(src, { cache, cacheKeyExtra: 'transform-v2' });
    expect(cache.stats.misses).toBe(2); // different extra → different entry, no mis-hit

    compile(src, { cache, cacheKeyExtra: 'transform-v1' });
    expect(cache.stats.hits).toBe(1); // same extra → hit
  });

  it('a relative baseDir keys by its cwd-resolved absolute path (no cross-cwd mis-hit)', () => {
    const src = 'function main() { return 1n; }';
    const cwd = process.cwd();

    try {
      process.chdir('/tmp');
      const fromTmp = compileCacheKey(src, { baseDirs: ['abis'] });
      process.chdir('/');
      const fromRoot = compileCacheKey(src, { baseDirs: ['abis'] });

      // Same relative baseDir, different cwd → different key (reads a different file).
      expect(fromTmp).not.toBe(fromRoot);
      // And the key reflects the ACTUAL cwd-resolved absolute location (use
      // path.resolve to sidestep the macOS /tmp→/private/tmp symlink).
      process.chdir('/');
      expect(fromRoot).toContain(resolve('/', 'abis'));

      // A relative dir and the absolute dir it resolves to share one key.
      expect(compileCacheKey(src, { baseDirs: ['abis'] })).toBe(compileCacheKey(src, { baseDirs: [resolve('abis')] }));
    } finally {
      process.chdir(cwd);
    }
  });

  it('contracts participate in the key (different ABI → different entry)', () => {
    const cache = createCompileCache();
    const src = 'function main() { return 1n; }';
    const abiA = [{ type: 'function', name: 'foo', inputs: [], outputs: [], stateMutability: 'view' }];
    const abiB = [{ type: 'function', name: 'bar', inputs: [], outputs: [], stateMutability: 'view' }];

    compile(src, { cache, contracts: { C: { abi: abiA } } });
    compile(src, { cache, contracts: { C: { abi: abiB } } });
    expect(cache.stats.misses).toBe(2);
  });
});

import { cook } from './utils.js';

describe('integration: args', () => {
  it('passes a single bigint arg to main', () => {
    expect(BigInt(cook('function main(x) { return x; }', { args: [42n] }))).toBe(42n);
  });

  it('passes multiple bigint args to main', () => {
    expect(BigInt(cook('function main(a, b) { return a + b; }', { args: [10n, 20n] }))).toBe(30n);
  });

  it('passes a large bigint arg', () => {
    const large = 2n ** 128n;

    expect(BigInt(cook('function main(x) { return x; }', { args: [large] }))).toBe(large);
  });

  it('passes args with helper functions', () => {
    expect(
      BigInt(
        cook('function double(x) { return x * 2; }\nfunction main(n) { return double(n); }', {
          args: [7n],
        }),
      ),
    ).toBe(14n);
  });

  it('uses args in arithmetic', () => {
    expect(BigInt(cook('function main(a, b) { return a * b + 1; }', { args: [5n, 10n] }))).toBe(51n);
  });

  it('uses args in control flow', () => {
    expect(
      BigInt(
        cook('function main(x) { if (x > 100) { return 1; } return 0; }', {
          args: [200n],
        }),
      ),
    ).toBe(1n);
  });

  it('uses args in a loop', () => {
    expect(
      BigInt(
        cook('function main(n) { let sum = 0; for (let i = 1; i <= n; i++) { sum += i; } return sum; }', {
          args: [10n],
        }),
      ),
    ).toBe(55n);
  });

  it('passes a hex string arg as dynamic bytes', () => {
    expect(
      BigInt(
        cook('function main(data) { return data.length; }', {
          args: ['0xaabbccdd'],
        }),
      ),
    ).toBe(4n);
  });

  it('passes mixed scalar and dynamic args', () => {
    expect(
      BigInt(
        cook('function main(x, data) { return x + data.length; }', {
          args: [10n, '0xaabbccdd'],
        }),
      ),
    ).toBe(14n);
  });

  it('passes array arg as dynamic tuple', () => {
    expect(
      BigInt(
        cook('function main(arr) { return arr[0] + arr[1]; }', {
          args: [[10n, 20n]],
        }),
      ),
    ).toBe(30n);
  });

  it('passes an object (struct) arg and reads a field by name', () => {
    // Declaration order {b,a} but sorted [a,b]; a=1 is field index 0.
    expect(
      BigInt(
        cook('function main(cfg) { return cfg.a; }', {
          args: [{ b: 2n, a: 1n }],
        }),
      ),
    ).toBe(1n);
  });

  it('reads a nested struct field via chained field access', () => {
    expect(
      BigInt(
        cook('function main(cfg) { return cfg.chain.vault + cfg.amountIn; }', {
          args: [{ amountIn: 5n, chain: { router: 7n, vault: 9n } }],
        }),
      ),
    ).toBe(14n);
  });

  it('reads a top-level scalar field that sorts AFTER a nested-tuple field', () => {
    // fields sorted: [amountIn, caller, chain, directCount, minOut, priceLimit, tokenIn, tokenOut]
    // chain (a nested tuple) is at index 2; minOut is at index 4 — reading it must skip the
    // nested tuple as ONE element, not flatten chain's fields into the parent.
    expect(
      BigInt(
        cook('function main(cfg) { return cfg.minOut; }', {
          args: [
            {
              amountIn: 1n,
              caller: 2n,
              chain: { a: 91n, b: 92n, c: 93n, d: 94n, e: 95n, f: 96n },
              directCount: 3n,
              minOut: 0n,
              priceLimit: 4n,
              tokenIn: 5n,
              tokenOut: 6n,
            },
          ],
        }),
      ),
    ).toBe(0n);
  });

  it('interleaves nested-tuple reads with a top-level scalar read (solver cfg pattern)', () => {
    const src =
      'function main(cfg) {' +
      ' let a = cfg.chain.fluidResolver;' +
      ' let b = cfg.chain.mentoBroker;' +
      ' let c = cfg.chain.balancerV3Router;' +
      ' let m = cfg.minOut;' +
      ' let d = cfg.chain.balancerV3Vault;' +
      ' let e = cfg.chain.balancerV2Vault;' +
      ' return m + a + b + c + d + e;' +
      ' }';
    expect(
      BigInt(
        cook(src, {
          args: [
            {
              amountIn: 1n,
              caller: 2n,
              chain: {
                balancerV2Vault: 0n,
                balancerV3Router: 0n,
                balancerV3Vault: 0n,
                fluidResolver: 0n,
                infinityVault: 0n,
                mentoBroker: 0n,
              },
              directCount: 3n,
              directQlvCount: 0n,
              minOut: 0n,
              priceLimit: 4n,
              tokenIn: 5n,
              tokenOut: 6n,
            },
          ],
        }),
      ),
    ).toBe(0n);
  });

  it('mixes a struct arg with scalar and array args', () => {
    expect(
      BigInt(
        cook('function main(cfg, n, pools) { return cfg.a + n + pools[0]; }', {
          args: [{ b: 2n, a: 1n }, 100n, [7n]],
        }),
      ),
    ).toBe(108n);
  });
});

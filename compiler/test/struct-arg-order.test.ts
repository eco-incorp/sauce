import { compile } from '../src/index.js';
import { encodeInt } from '../src/saucer/integer.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// A contract method that takes a nested struct, where the ABI's DECLARATION order
// differs from alphabetical order at BOTH levels:
//   params (declared):  poolType, pool, poolKey, tokenIn, amountSpecified
//   params (alphabetical): amountSpecified, pool, poolKey, poolType, tokenIn
//   poolKey (declared):  currency0, currency1, fee, tickSpacing, hooks
//   poolKey (alphabetical): currency0, currency1, fee, hooks, tickSpacing   <- hooks/tickSpacing swap
//
// When a struct is passed to a contract call, the engine ABI-encodes the TUPLE
// positionally (it flattens all-scalar tuples inline), so the compiler MUST emit
// the fields in ABI-declaration order. Emitting them alphabetically (the internal
// canonical order used for `obj.field` reads) produces wrong calldata.
const routerAbi = [
  {
    type: 'function' as const,
    name: 'swap',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'poolType', type: 'uint256' },
          { name: 'pool', type: 'uint256' },
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'uint256' },
              { name: 'currency1', type: 'uint256' },
              { name: 'fee', type: 'uint256' },
              { name: 'tickSpacing', type: 'uint256' },
              { name: 'hooks', type: 'uint256' },
            ],
          },
          { name: 'tokenIn', type: 'uint256' },
          { name: 'amountSpecified', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
];

// Distinctive 4-byte sentinel value per field (low byte unique → easy to locate).
const V = {
  poolType: 0xe1_00_00_01n,
  pool: 0xe1_00_00_02n,
  currency0: 0xe2_00_00_01n,
  currency1: 0xe2_00_00_02n,
  fee: 0xe2_00_00_03n,
  tickSpacing: 0xe2_00_00_04n,
  hooks: 0xe2_00_00_05n,
  tokenIn: 0xe1_00_00_04n,
  amountSpecified: 0xe1_00_00_05n,
};

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-struct-order-'));
  fs.writeFileSync(path.join(tmpDir, 'Router.json'), JSON.stringify({ abi: routerAbi }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }

    return i;
  }

  return -1;
}

/** Order the field names by where their sentinel value appears in the bytecode. */
function fieldOrderInBytecode(bytecode: Uint8Array): string[] {
  return Object.entries(V)
    .map(([name, value]) => {
      const at = indexOfBytes(bytecode, encodeInt(value));
      expect(at).toBeGreaterThanOrEqual(0); // sentinel must be present exactly once

      return { name, at };
    })
    .sort((a, b) => a.at - b.at)
    .map((e) => e.name);
}

describe('struct argument field ordering (contract calls)', () => {
  // Source object written in neither declaration nor alphabetical order, to prove
  // the ABI drives the encoding order (not source order, not alphabetical).
  const source = `
    import { Router } from "./Router.json";
    function main() {
      Router.at(1).swap({
        tokenIn: ${V.tokenIn}n,
        poolKey: {
          hooks: ${V.hooks}n,
          fee: ${V.fee}n,
          currency1: ${V.currency1}n,
          tickSpacing: ${V.tickSpacing}n,
          currency0: ${V.currency0}n,
        },
        amountSpecified: ${V.amountSpecified}n,
        poolType: ${V.poolType}n,
        pool: ${V.pool}n,
      });
      return 0;
    }
  `;

  it('emits all struct fields in ABI-declaration order (both levels)', () => {
    const { bytecode } = compile(source, { baseDirs: [tmpDir] });
    const order = fieldOrderInBytecode(bytecode[0]);

    expect(order).toEqual([
      'poolType',
      'pool',
      'currency0',
      'currency1',
      'fee',
      'tickSpacing',
      'hooks',
      'tokenIn',
      'amountSpecified',
    ]);
  });

  it('orders nested poolKey fields as declared (tickSpacing before hooks)', () => {
    const { bytecode } = compile(source, { baseDirs: [tmpDir] });
    const order = fieldOrderInBytecode(bytecode[0]);

    expect(order.indexOf('tickSpacing')).toBeLessThan(order.indexOf('hooks'));
  });
});

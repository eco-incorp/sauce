import { cook, deploy } from './utils.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Runtime verification of array destructuring on the REAL v1 engine: the
// deployed engines are immutable, and a decoded tuple stored in a variable
// faults INDEX with SauceInvalidOperationArgs(0x97) — so the lowering keeps only
// RAW returndata in a hidden temp and re-decodes per element. Mocks are
// hand-assembled runtime bytecode etched via anvil_setCode: return shapes
// (fixed words, a storage counter, bytes tails, array tails) chosen to pin
// decode offsets and prove single evaluation.
const RPC = 'http://127.0.0.1:8546';

const etch = (address: string, code: string): void => {
  execSync(`cast rpc anvil_setCode ${address} ${code} --rpc-url ${RPC}`, { encoding: 'utf8' });
};

// Returns (5, 7, 0, 0, 0, 0, 0) for any calldata — 7 words.
const SEVEN_ADDR = '0x0000000000000000000000000000000000007001';
const SEVEN_CODE = '0x6005600052600760205260e06000f3';

// Increments storage slot 0, returns (counter, counter * 2). Nonpayable in the
// ABI → the engine uses CALL, so within one cook() the state advances per call:
// 1st call → (1, 2), 2nd call → (2, 4). Distinguishes one evaluation from two.
const COUNTER_ADDR = '0x0000000000000000000000000000000000007002';
const COUNTER_CODE = '0x5f54600101805f55805f5260020260205260405ff3';

// Returns (5, bytes "abc") — ABI head/tail with a dynamic component.
const META_ADDR = '0x0000000000000000000000000000000000007003';
const META_CODE =
  '0x60055f5260406020526003604052' +
  '7f6162630000000000000000000000000000000000000000000000000000000000' +
  '60605260805ff3';

// Returns (9, uint256[] [11, 22]).
const LIST_ADDR = '0x0000000000000000000000000000000000007004';
const LIST_CODE = '0x60095f5260406020526002604052600b606052601660805260a05ff3';

// Returns (uint160 0x42, int24 -100 [sign-extended: NOT(0x63)], bool true,
// address 0xabcd) — pins decode semantics for SIGNED components: the engine's
// canonical intN form is the low N bytes (zero-extended), so tick must read as
// 0xffff9c = 16777116, the exact value the v12 SLICE+CAST_BE fast path produces
// geometrically.
const PROBE_ADDR = '0x0000000000000000000000000000000000007005';
const PROBE_CODE = '0x60425f52606319602052600160405261abcd60605260805ff3';

const uint256 = (name: string) => ({ name, type: 'uint256' });

const mockAbis: Record<string, unknown[]> = {
  Seven: [
    {
      type: 'function',
      name: 'vals',
      inputs: [],
      outputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(uint256),
      stateMutability: 'view',
    },
  ],
  Counter: [
    {
      type: 'function',
      name: 'bump',
      inputs: [],
      outputs: [uint256('counter'), uint256('twice')],
      stateMutability: 'nonpayable',
    },
  ],
  Meta: [
    {
      type: 'function',
      name: 'meta',
      inputs: [],
      outputs: [uint256('n'), { name: 'data', type: 'bytes' }],
      stateMutability: 'view',
    },
  ],
  List: [
    {
      type: 'function',
      name: 'list',
      inputs: [],
      outputs: [uint256('n'), { name: 'xs', type: 'uint256[]' }],
      stateMutability: 'view',
    },
  ],
  Probe: [
    {
      type: 'function',
      name: 'probe',
      inputs: [],
      outputs: [
        { name: 'big', type: 'uint160' },
        { name: 'tick', type: 'int24' },
        { name: 'flag', type: 'bool' },
        { name: 'who', type: 'address' },
      ],
      stateMutability: 'view',
    },
  ],
};

let tmpDir: string;
let baseDirs: string[];

beforeAll(() => {
  etch(SEVEN_ADDR, SEVEN_CODE);
  etch(COUNTER_ADDR, COUNTER_CODE);
  etch(META_ADDR, META_CODE);
  etch(LIST_ADDR, LIST_CODE);
  etch(PROBE_ADDR, PROBE_CODE);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-destructuring-int-'));
  for (const [name, abi] of Object.entries(mockAbis)) {
    fs.writeFileSync(path.join(tmpDir, `${name}.json`), JSON.stringify({ abi }));
  }

  baseDirs = [tmpDir];
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const run = (body: string, imports: string[]): bigint => {
  const header = imports.map((name) => `import { ${name} } from "./${name}.json";`).join('\n');

  return BigInt(cook(`${header}\nfunction main() {\n${body}\n}`, { baseDirs }));
};

describe('integration: array destructuring (v1 engine)', () => {
  it('shape C: destructures two of seven outputs', () => {
    expect(run(`const [a, b] = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return a + b;`, ['Seven'])).toBe(12n);
  });

  it('shape C: holes skip outputs', () => {
    expect(run(`const [, b] = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return b;`, ['Seven'])).toBe(7n);
  });

  it('shape C: binds all seven outputs', () => {
    expect(
      run(`const [a, b, c, d, e, f, g] = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return a + b + c + d + e + f + g;`, [
        'Seven',
      ]),
    ).toBe(12n);
  });

  it('shape C: works with a variable-bound contract', () => {
    expect(
      run(`const pool = Seven.at(${BigInt(SEVEN_ADDR)}n); const [a, b] = pool.vals(); return a + b;`, ['Seven']),
    ).toBe(12n);
  });

  it('makes exactly ONE external call (stateful counter proof)', () => {
    // one evaluation: (1, 2) → 102. A double-evaluating lowering would read the
    // second element from a second call → (…, 4) → 104.
    expect(run(`const [c, t] = Counter.at(${BigInt(COUNTER_ADDR)}n).bump(); return c * 100 + t;`, ['Counter'])).toBe(
      102n,
    );
  });

  it('counter mock control: the old double-call shape really evaluates twice', () => {
    expect(
      run(
        `return Counter.at(${BigInt(COUNTER_ADDR)}n).bump()[0] * 100 + Counter.at(${BigInt(COUNTER_ADDR)}n).bump()[1];`,
        ['Counter'],
      ),
    ).toBe(104n);
  });

  it('destructures a bytes component onto the heap', () => {
    expect(run(`const [n, data] = Meta.at(${BigInt(META_ADDR)}n).meta(); return n + data.length;`, ['Meta'])).toBe(8n);
  });

  it('returns the destructured bytes verbatim', () => {
    const result = cook(
      `import { Meta } from "./Meta.json";
       function main() {
         const [, data] = Meta.at(${BigInt(META_ADDR)}n).meta();
         return data;
       }`,
      { baseDirs },
    );

    expect(result).toBe('0x616263');
  });

  it('destructures an array component and indexes it after the round-trip', () => {
    expect(
      run(`const [n, xs] = List.at(${BigInt(LIST_ADDR)}n).list(); return n + xs[0] + xs[1] + xs.length;`, ['List']),
    ).toBe(44n);
  });

  it('array component behind a hole', () => {
    expect(run(`const [, xs] = List.at(${BigInt(LIST_ADDR)}n).list(); return xs[1];`, ['List'])).toBe(22n);
  });

  it('negative signed intN component decodes to the canonical low-N-bytes form', () => {
    // int24 -100: sign-extended word 0xff…ff9c → canonical 0xffff9c. This is the
    // exact value the v12 SLICE+CAST_BE fast path extracts geometrically — the
    // v1 run pins the reference semantics the fast path must match.
    expect(run(`const [, tick] = Probe.at(${BigInt(PROBE_ADDR)}n).probe(); return tick;`, ['Probe'])).toBe(0xffff9cn);
  });

  it('mixed-width statics (uint160, bool, address) bind correctly around the signed component', () => {
    expect(
      run(
        `const [big, tick, flag, who] = Probe.at(${BigInt(PROBE_ADDR)}n).probe(); return (big + flag) * 100000 + who;`,
        ['Probe'],
      ),
    ).toBe(BigInt(0x42 + 1) * 100000n + 0xabcdn);
  });
});

describe('integration: shape B — stored multi-output result is a compile-time guard (v1)', () => {
  it('const s = call(); s[k] is rejected at COMPILE time (previously faulted SauceInvalidOperationArgs(INDEX) at runtime)', () => {
    expect(() => run(`const s = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return s[0] + s[1];`, ['Seven'])).toThrow(
      /cannot index 's'.*destructure/,
    );
  });

  it('bare reads of the stored result still compile and run (protocol `return result` shape)', () => {
    // The engine returns the stored word for a bare read — unchanged legacy
    // semantics (its value is engine-internal, so it is not pinned); the point
    // is that compilation and execution of the actual bare READ both succeed.
    expect(() => run(`const s = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return s;`, ['Seven'])).not.toThrow();
  });

  it('a multi-output call stored into a DYNAMIC variable round-trips and indexes correctly', () => {
    // the heap store preserves the decoded tuple on v1 (the reason the guard is
    // storage-kind-aware): s was declared as an array literal → heap slot
    expect(run(`let s = [0, 0]; s = Seven.at(${BigInt(SEVEN_ADDR)}n).vals(); return s[1];`, ['Seven'])).toBe(7n);
  });

  it('shape A (inline chained indexing) still works unchanged', () => {
    expect(
      run(`return Seven.at(${BigInt(SEVEN_ADDR)}n).vals()[0] + Seven.at(${BigInt(SEVEN_ADDR)}n).vals()[1];`, ['Seven']),
    ).toBe(12n);
  });
});

describe('integration: destructuring a real contract (ReturnTest)', () => {
  const baseDirsReturnTest = [resolve(process.cwd(), 'node_modules/sauce/engine/out/ReturnTest.sol')];
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/ReturnTest.sol:ReturnTest'));
  });

  it('destructures the scalar output, hole over the nested tuple', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01]);
        const [nonce] = ReturnTest.at(addr).wrap(123, data);
        return nonce;
      }
    `,
          { baseDirs: baseDirsReturnTest },
        ),
      ),
    ).toBe(0n);
  });

  it('single evaluation: wrap() advances the nonce exactly once', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01]);
        const before = ReturnTest.at(addr).nonce();
        const [n1] = ReturnTest.at(addr).wrap(1, data);
        const after = ReturnTest.at(addr).nonce();
        return (after - before) * 100 + (n1 - before);
      }
    `,
          { baseDirs: baseDirsReturnTest },
        ),
      ),
    ).toBe(100n);
  });

  it('indexing a stored wrap() result is rejected at compile time', () => {
    expect(() =>
      cook(
        `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01, 0x02]);
        const s = ReturnTest.at(addr).wrap(123, data);
        return s[0];
      }
    `,
        { baseDirs: baseDirsReturnTest },
      ),
    ).toThrow(/cannot index 's'/);
  });
});

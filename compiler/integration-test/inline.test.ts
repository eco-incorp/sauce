import { cook, deploy, getSauceAddress } from './utils.js';
import { resolve } from 'path';

const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/MockTarget.sol')];

describe('integration: $ inline', () => {
  let addr: bigint;
  let sauceAddr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
    sauceAddr = BigInt(getSauceAddress());
  });

  it('static inline (no interpolations) returns bytecodes', () => {
    expect(
      BigInt(
        cook(`
      function main() {
        const inner = $\`return 42;\`;
        return inner.length;
      }
    `),
      ),
    ).toBeGreaterThan(0n);
  });

  it('inline with scalar interpolation via eval()', () => {
    expect(
      BigInt(
        cook(`
      function main() {
        const x = 42;
        const inner = $\`return \${x};\`;
        return eval(inner);
      }
    `),
      ),
    ).toBe(42n);
  });

  it('inline with multiple scalar interpolations via eval()', () => {
    expect(
      BigInt(
        cook(`
      function main() {
        const a = 10;
        const b = 20;
        const inner = $\`
          const x = \${a};
          const y = \${b};
          return x + y;
        \`;
        return eval(inner);
      }
    `),
      ),
    ).toBe(30n);
  });

  it('inline with contract call using outer scope address via eval()', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const target = ${addr}n;
        MockTarget.at(target).setValue(77);
        const inner = $\`
          return MockTarget.at(\${target}).getValue();
        \`;
        return eval(inner);
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(77n);
  });

  it('inline inside a loop with array indexing', () => {
    expect(
      BigInt(
        cook(`
      function main() {
        const values = [10, 20, 30];
        let total = 0;
        for (let i = 0; i < values.length; i++) {
          const inner = $\`return \${values[i]};\`;
          total = total + eval(inner);
        }
        return total;
      }
    `),
      ),
    ).toBe(60n);
  });

  it('inline with cook() + catch for revert data capture', () => {
    const sauceAbi = [
      {
        type: 'function' as const,
        name: 'cook',
        inputs: [{ name: 'ingredients', type: 'bytes[]' }],
        outputs: [{ name: 'returnData', type: 'bytes' }],
        stateMutability: 'payable' as const,
      },
    ];

    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const target = ${addr}n;
        MockTarget.at(target).setValue(555);
        const inner = $\`
          const out = MockTarget.at(\${target}).getValue();
          throw abi.encode(out);
        \`;
        let result = 0;
        ISauce.at(${sauceAddr}n).cook([inner]).catch((e) => {
          result = abi.decode(e, 'uint256')[0];
        });
        return result;
      }
    `,
          { baseDirs, contracts: { ISauce: { abi: sauceAbi } } },
        ),
      ),
    ).toBe(555n);
  });
});

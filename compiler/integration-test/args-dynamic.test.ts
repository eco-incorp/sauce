import { cook, deploy, getSauceAddress } from './utils.js';
import { resolve } from 'path';

const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/MockTarget.sol')];

const sauceAbi = [
  {
    type: 'function' as const,
    name: 'cook',
    inputs: [{ name: 'ingredients', type: 'bytes[]' }],
    outputs: [{ name: 'returnData', type: 'bytes' }],
    stateMutability: 'payable' as const,
  },
];

describe('integration: dynamic args with cook + catch', () => {
  let addr: bigint;
  let sauceAddr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
    sauceAddr = BigInt(getSauceAddress());
  });

  it('cook+catch with embedded values (baseline)', () => {
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

  it('cook+catch with scalar args', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main(target, sauceAddr) {
        MockTarget.at(target).setValue(555);
        const inner = $\`
          const out = MockTarget.at(\${target}).getValue();
          throw abi.encode(out);
        \`;
        let result = 0;
        ISauce.at(sauceAddr).cook([inner]).catch((e) => {
          result = abi.decode(e, 'uint256')[0];
        });
        return result;
      }
    `,
          { baseDirs, contracts: { ISauce: { abi: sauceAbi } }, args: [addr, sauceAddr] },
        ),
      ),
    ).toBe(555n);
  });

  it('hex bytes arg read back length', () => {
    expect(
      BigInt(
        cook('function main(data) { return data.length; }', {
          args: ['0xaabbccdd'],
        }),
      ),
    ).toBe(4n);
  });

  it('array arg with indexing', () => {
    expect(
      BigInt(
        cook('function main(arr) { return arr[1]; }', {
          args: [[10n, 42n, 30n]],
        }),
      ),
    ).toBe(42n);
  });

  it('array of bytes arg — element access returns bytes', () => {
    const cd1 = '0xaabbccdd';
    const cd2 = '0x11223344';
    // Just verify we can read an element and get its length
    expect(
      BigInt(
        cook('function main(calldatas) { return calldatas[0].length; }', {
          args: [[cd1, cd2]],
        }),
      ),
    ).toBe(4n);
  });

  it('array of bytes arg — element in raw contract.call works', () => {
    // selector for setValue(uint256) = 0x55241077, setValue(77)
    const calldata = '0x55241077000000000000000000000000000000000000000000000000000000000000004d';

    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main(target, calldatas) {
        contract.call(target, 0, calldatas[0]);
        return MockTarget.at(target).getValue();
      }
    `,
          { baseDirs, args: [addr, [calldata]] },
        ),
      ),
    ).toBe(77n);
  });

  it('array of bytes arg — element in $`` template', () => {
    const calldata = '0x55241077000000000000000000000000000000000000000000000000000000000000004d';

    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main(target, calldatas) {
        const inner = $\`
          contract.call(\${target}, 0, \${calldatas[0]});
        \`;
        eval(inner);
        return MockTarget.at(target).getValue();
      }
    `,
          { baseDirs, args: [addr, [calldata]] },
        ),
      ),
    ).toBe(77n);
  });

  it('cook+catch with bytes array arg (LM pattern)', () => {
    // selector for setValue(uint256) = 0x55241077
    const setValue77 = '0x55241077000000000000000000000000000000000000000000000000000000000000004d';
    const setValue99 = '0x552410770000000000000000000000000000000000000000000000000000000000000063';

    // Inner program: call setValue, then throw the value it set
    // The cook() reverts with abi.encode(getValue()), catch(e) decodes it
    // Route with setValue(99) should win (99 > 77)
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main(target, sauceAddr, calldatas) {
        let best = 0;
        for (let i = 0; i < calldatas.length; i++) {
          let out = 0;
          ISauce.at(sauceAddr).cook([$\`
            contract.call(\${target}, 0, \${calldatas[i]});
            throw abi.encode(MockTarget.at(\${target}).getValue());
          \`]).catch((e) => {
            out = abi.decode(e, 'uint256')[0];
          });
          if (out > best) { best = out; }
        }
        return best;
      }
    `,
          { baseDirs, contracts: { ISauce: { abi: sauceAbi } }, args: [addr, sauceAddr, [setValue77, setValue99]] },
        ),
      ),
    ).toBe(99n);
  });
});

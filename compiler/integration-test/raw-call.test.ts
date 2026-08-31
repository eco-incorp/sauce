import { cook, deploy } from './utils.js';
import { resolve } from 'path';

const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/MockTarget.sol')];

describe('integration: contract.call() builtin', () => {
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
  });

  it('contract.call(addr, 0, data) executes external call and read back', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        MockTarget.at(addr).setValue(42);
        return MockTarget.at(addr).getValue();
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(42n);
  });

  it('contract.call with .catch() handles revert', () => {
    // revertWithMessage() selector = 0x185c38a4
    expect(
      BigInt(
        cook(
          `
      function main() {
        const addr = ${addr}n;
        let result = 0;
        const calldata = Uint8Array.from([0x18, 0x5c, 0x38, 0xa4]);
        contract.call(addr, 0, calldata).catch(() => {
          result = 42;
        });
        return result;
      }
    `,
        ),
      ),
    ).toBe(42n);
  });

  it('contract.call with .catch(e) captures revert data', () => {
    // revertWithValue(99) selector = 0x0fffb184, abi.encode(99) = 0x63 padded
    expect(
      BigInt(
        cook(
          `
      function main() {
        const addr = ${addr}n;
        let dataLen = 0;
        const calldata = Uint8Array.from([
          0x0f, 0xff, 0xb1, 0x84,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x63
        ]);
        contract.call(addr, 0, calldata).catch((e) => {
          dataLen = e.length;
        });
        return dataLen;
      }
    `,
        ),
      ),
    ).toBe(32n);
  });

  it('contract.call successful call does not trigger catch', () => {
    // setValue(55) selector = 0x55241077, abi.encode(55) = 0x37 padded
    expect(
      BigInt(
        cook(
          `
      function main() {
        const addr = ${addr}n;
        let result = 1;
        const calldata = Uint8Array.from([
          0x55, 0x24, 0x10, 0x77,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x37
        ]);
        contract.call(addr, 0, calldata).catch(() => {
          result = 2;
        });
        return result;
      }
    `,
        ),
      ),
    ).toBe(1n);
  });
});

describe('integration: contract.static() builtin', () => {
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
  });

  it('contract.static(addr, data) executes static call', () => {
    // getAnswer() selector = 0x9c16667c, returns 42
    expect(
      BigInt(
        cook(
          `
      function main() {
        const addr = ${addr}n;
        const calldata = Uint8Array.from([0x9c, 0x16, 0x66, 0x7c]);
        const result = contract.static(addr, calldata);
        return abi.decode(result, 'uint256')[0];
      }
    `,
        ),
      ),
    ).toBe(42n);
  });

  it('contract.static with .catch() on success skips handler', () => {
    expect(
      BigInt(
        cook(
          `
      function main() {
        const addr = ${addr}n;
        let result = 1;
        const calldata = Uint8Array.from([0x9c, 0x16, 0x66, 0x7c]);
        contract.static(addr, calldata).catch(() => {
          result = 0;
        });
        return result;
      }
    `,
        ),
      ),
    ).toBe(1n);
  });
});

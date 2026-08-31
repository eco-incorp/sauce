import { cook, deploy } from './utils.js';
import { resolve } from 'path';

describe('integration: contract calls', () => {
  const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/Logger.sol')];
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/Logger.sol:Logger'));
  });

  it('view call returns default mapping value', () => {
    expect(
      BigInt(
        cook(
          `
      import { Logger } from "./Logger.json";
      function main() {
        const addr = ${addr}n;
        return Logger.at(addr).logs(1);
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(0n);
  });

  it('state-changing call followed by view call', () => {
    expect(
      BigInt(
        cook(
          `
      import { Logger } from "./Logger.json";
      function main() {
        const addr = ${addr}n;
        Logger.at(addr).log(42, 1);
        return Logger.at(addr).logs(1);
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(42n);
  });

  it('multiple logs and read back', () => {
    expect(
      BigInt(
        cook(
          `
      import { Logger } from "./Logger.json";
      function main() {
        const addr = ${addr}n;
        Logger.at(addr).log(10, 3);
        return Logger.at(addr).logs(2);
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(10n);
  });

  it('call with expressions as args', () => {
    expect(
      BigInt(
        cook(
          `
      import { Logger } from "./Logger.json";
      function main() {
        const addr = ${addr}n;
        const val = 7;
        Logger.at(addr).log(val * 6, 1);
        return Logger.at(addr).logs(1);
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(42n);
  });
});

describe('integration: abi decode on contract call returns', () => {
  const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/ReturnTest.sol')];
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/ReturnTest.sol:ReturnTest'));
  });

  it('single return: nonce() returns decoded uint256', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        return ReturnTest.at(addr).nonce();
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(0n);
  });

  it('state-changing call with multi-return: wrap() increments nonce', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01]);
        const nonce = ReturnTest.at(addr).nonce();
        ReturnTest.at(addr).wrap(1, data);
        return ReturnTest.at(addr).nonce() - nonce;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(1n);
  });

  it('state-changing call with multi-return: wrap() returns the nonce', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01]);
        const nonce = ReturnTest.at(addr).nonce();
        return nonce - ReturnTest.at(addr).wrap(1, data)[0];
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(0n);
  });

  it('state-changing call with multi-return: wrap() returns the value', () => {
    expect(
      BigInt(
        cook(
          `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01]);
        const nonce = ReturnTest.at(addr).nonce();
        return ReturnTest.at(addr).wrap(123, data)[1][0];
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(123n);
  });

  it('state-changing call with multi-return: wrap() returns the data', () => {
    expect(
      cook(
        `
      import { ReturnTest } from "./ReturnTest.json";
      function main() {
        const addr = ${addr}n;
        const data = Uint8Array.from([0x01, 0x02, 0x03]);
        const nonce = ReturnTest.at(addr).nonce();
        return ReturnTest.at(addr).wrap(123, data)[1][1];
      }
    `,
        { baseDirs },
      ),
    ).toBe('0x010203');
  });
});

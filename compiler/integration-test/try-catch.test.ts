import { cook, deploy } from './utils.js';
import { resolve } from 'path';

const baseDirs = [resolve(process.cwd(), 'node_modules/sauce/engine/out/MockTarget.sol')];

describe('integration: .catch()', () => {
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
  });

  it('successful call: catch handler skipped', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 1;
        MockTarget.at(addr).setValue(42).catch(() => {
          result = 2;
        });
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(1n);
  });

  it('successful call: state change persists after .catch()', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        MockTarget.at(addr).setValue(99).catch(() => {});
        return MockTarget.at(addr).getValue();
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(99n);
  });

  it('reverting call: catch handler runs', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 0;
        MockTarget.at(addr).revertWithMessage().catch(() => {
          result = 42;
        });
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(42n);
  });

  it('reverting call: code after .catch() runs', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 0;
        MockTarget.at(addr).revertWithMessage().catch(() => {});
        result = 77;
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(77n);
  });

  it('reverting call: catch handler sets flag readable after .catch()', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let failed = 0;
        MockTarget.at(addr).revertWithMessage().catch(() => {
          failed = 1;
        });
        return failed;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(1n);
  });

  it('.catch() with empty handler on success', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        MockTarget.at(addr).setValue(55).catch(() => {});
        return MockTarget.at(addr).getValue();
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(55n);
  });

  it('.catch() with empty handler on failure', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        MockTarget.at(addr).revertWithMessage().catch(() => {});
        return 100;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(100n);
  });

  it('catch handler with multiple statements', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let a = 0;
        let b = 0;
        MockTarget.at(addr).revertWithMessage().catch(() => {
          a = 10;
          b = 20;
        });
        return a + b;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(30n);
  });

  it('multiple .catch() blocks in sequence', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let a = 0;
        let b = 0;
        MockTarget.at(addr).revertWithMessage().catch(() => {
          a = 10;
        });
        MockTarget.at(addr).setValue(200).catch(() => {
          b = 99;
        });
        b = 20;
        return a + b;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(30n);
  });
});

describe('integration: .catch(e) with revert data', () => {
  let addr: bigint;

  beforeAll(() => {
    addr = BigInt(deploy('test/mocks/MockTarget.sol:MockTarget'));
  });

  it('catch(e) captures revert data as bytes', () => {
    // revertWithValue(42) reverts with abi.encode(42)
    // catch(e) should capture the revert data, which has non-zero length
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let dataLen = 0;
        MockTarget.at(addr).revertWithValue(42).catch((e) => {
          dataLen = e.length;
        });
        return dataLen;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(32n); // abi.encode(uint256) is 32 bytes
  });

  it('catch(e) with abi.decode extracts uint256 from revert data', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 0;
        MockTarget.at(addr).revertWithValue(99).catch((e) => {
          const decoded = abi.decode(e, 'uint256');
          result = decoded[0];
        });
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(99n);
  });

  it('catch(e) on successful call does not run handler', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 1;
        MockTarget.at(addr).setValue(42).catch((e) => {
          result = 0;
        });
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(1n);
  });

  it('multiple catch(e) in sequence', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let out1 = 0;
        let out2 = 0;
        MockTarget.at(addr).revertWithValue(100).catch((e) => {
          out1 = abi.decode(e, 'uint256')[0];
        });
        MockTarget.at(addr).revertWithValue(200).catch((e) => {
          out2 = abi.decode(e, 'uint256')[0];
        });
        return out1 + out2;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(300n);
  });

  it('variable-bound contract with catch(e)', () => {
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let result = 0;
        const mock = MockTarget.at(addr);
        mock.revertWithValue(77).catch((e) => {
          result = abi.decode(e, 'uint256')[0];
        });
        return result;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(77n);
  });

  it('catch(e) on success captures return data', () => {
    // echo(42) returns 42 — on success, e should contain the return data
    expect(
      BigInt(
        cook(
          `
      import { MockTarget } from "./MockTarget.json";
      function main() {
        const addr = ${addr}n;
        let dataLen = 0;
        MockTarget.at(addr).echo(42).catch((e) => {
          dataLen = 999;
        });
        return dataLen;
      }
    `,
          { baseDirs },
        ),
      ),
    ).toBe(0n); // handler should NOT run on success
  });
});

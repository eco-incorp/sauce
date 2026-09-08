import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compileSauceFunctionRust, computeSelector, extractSelectors } from "./helpers";

const PROTOCOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "protocols");

describe("test helpers", () => {
  describe("compileSauceFunctionRust", () => {
    it("compiles a simple SauceScript without imports", () => {
      const source = `
function main(): Uint256 {
  return 1;
}
`;
      const result = compileSauceFunctionRust(source, PROTOCOLS_DIR);
      expect(result.bytecode.length).toBeGreaterThan(0);
    });

    it("compiles aave-v3 supply function with ABI import", () => {
      const source = `
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
`;
      const protocolDir = join(PROTOCOLS_DIR, "aave-v3");
      const result = compileSauceFunctionRust(source, protocolDir);
      expect(result.bytecode.length).toBeGreaterThan(0);
    });
  });

  describe("computeSelector", () => {
    it("computes correct selector for ERC20 transfer", () => {
      expect(computeSelector("transfer(address,uint256)")).toBe("0xa9059cbb");
    });

    it("computes correct selector for ERC20 approve", () => {
      expect(computeSelector("approve(address,uint256)")).toBe("0x095ea7b3");
    });
  });

  describe("extractSelectors", () => {
    it("finds BYTE_4 selectors in bytecode", () => {
      const segment = new Uint8Array([0x00, 0x04, 0xa9, 0x05, 0x9c, 0xbb, 0x00]);
      const selectors = extractSelectors([segment]);
      expect(selectors).toContain("0xa9059cbb");
    });
  });
});

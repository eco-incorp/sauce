/**
 * A chain's name is its chain id in compiled source: `chainId == Ethereum` is decided while
 * compiling, so a program compiled for a chain keeps only that chain's branch, byte for byte. The
 * name's members are names of their own: `Ethereum.UniswapV3.Factory` is still Ethereum's
 * contract. A chain's name called as a function, the intent form a program no longer has, is
 * refused as what it is.
 */
import { bytesToHex } from "viem";

import { CANONICAL_CHAINS } from "../src/chains/canonical.js";
import { pascalOfSlug } from "../src/routes/builder.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const bytecode = (chain: string, source: string): string =>
  bytesToHex(compileSauceProgram(chain, source, {}).bytecode);
const program = (body: string): string => `function main(recipient: Address) {\n${body}\n}`;

describe("a chain's name is its chain id", () => {
  const ethereum = "  USDC.transfer(recipient, 1);";
  const other = "  USDC.transfer(recipient, 2);";
  const branched = program(
    `  if (chainId == Ethereum) {\n  ${ethereum}\n  } else {\n  ${other}\n  }`,
  );

  it("keeps only the branch of the chain a program is compiled for", () => {
    expect(bytecode("ethereum", branched)).toBe(bytecode("ethereum", program(ethereum)));
    expect(bytecode("base", branched)).toBe(bytecode("base", program(other)));
  });

  it("is every canonical chain's id, as a value", () => {
    for (const chain of CANONICAL_CHAINS.filter((c) => c.kind === "evm")) {
      expect(
        bytecode("base", `function main(): Uint256 { return ${pascalOfSlug(chain.slug)}; }`),
      ).toBe(bytecode("base", `function main(): Uint256 { return ${chain.id}; }`));
    }
    expect(bytecode("solana", "function main(): Uint256 { return Solana; }")).toBe(
      bytecode("solana", "function main(): Uint256 { return 1399811149; }"),
    );
  });

  it("leaves its members their own names: a contract on that chain", () => {
    expect(
      bytecode("base", "function main(): Address { return Ethereum.UniswapV3.Factory; }"),
    ).toBe(
      bytecode(
        "base",
        "function main(): Address { return 0x1F98431c8aD98523631AE4a59f267346ea31F984; }",
      ),
    );
  });

  it("refuses the old intent form, a chain's name called", () => {
    expect(() =>
      compileSauceProgram(
        "base",
        program(
          `  Arbitrum(() => { USDC.transfer(recipient, 1); }).reward({ token: USDC, amount: 1 });`,
        ),
        {},
      ),
    ).toThrow("an instance of `OnChain` is not a function, so it cannot be called");
  });
});

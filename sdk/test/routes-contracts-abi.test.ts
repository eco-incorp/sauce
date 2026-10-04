/**
 * `compile.contracts` takes an ABI as viem writes it.
 *
 * viem's `parseAbi` and an `as const` literal both type every array in an ABI `readonly`, and the
 * option's own ABI types declared them mutable, so a caller had to hand-type the ABI it already
 * held. These calls type the options as the SDK declares them, so this file failing to typecheck
 * is the regression.
 */
import { parseAbi, type Abi } from "viem";

import { compileSauceProgram, type SauceCompileOptions } from "../src/routes/sauce-route.js";

const SIGNATURES = [
  "struct Key { address token; uint24 fee; }",
  "function balanceOf(address owner) view returns (uint256)",
  "function quote(Key key, uint256 amount) view returns (uint256 out)",
  "event Deposit(address indexed owner, uint256 amount)",
  "error Paused()",
] as const;

const LITERAL = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "fee", type: "uint24" },
        ],
      },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "out", type: "uint256" }],
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "Paused", inputs: [] },
] as const;

const SOURCE = `
function main(vault: Address, owner: Address): Uint256 {
  return Vault.at(vault).balanceOf(owner);
}
`;

const compileWith = (options: SauceCompileOptions) =>
  compileSauceProgram("base", SOURCE, options).bytecode;

describe("compile.contracts", () => {
  it("takes viem's parseAbi output, an as-const literal and viem's Abi, compiling each alike", () => {
    const parsed = parseAbi(SIGNATURES);
    const widened: Abi = parsed;

    const fromParsed = compileWith({ contracts: { Vault: { abi: parsed } } });
    const fromLiteral = compileWith({ contracts: { Vault: { abi: LITERAL } } });
    const fromWidened = compileWith({ contracts: { Vault: { abi: widened } } });

    expect(fromParsed.length).toBeGreaterThan(0);
    expect(fromLiteral).toEqual(fromParsed);
    expect(fromWidened).toEqual(fromParsed);
  });
});

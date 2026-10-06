/**
 * An ABI binding given in `contracts` reaches an intent's body, as it reaches the program opening
 * it. A program argument takes no contracts of its own from the compiler, so the SDK declares each
 * one to the body as a contract with no address: the body calls it at one, byte for byte as an
 * `import` of the same ABI in the file does.
 */
import { bytesToHex } from "viem";

import type { Abi } from "../src/routes/compile-types.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";

const ABI: Abi = [
  {
    type: "function",
    name: "poke",
    stateMutability: "nonpayable",
    inputs: [{ name: "x", type: "uint256" }],
    outputs: [],
  },
];
const AT = "0x6666666666666666666666666666666666666666";
const INTENTS = {
  executionFee: 1_000n,
  openedAt: 2_000_000_000n,
  salt: `0x${"5a".repeat(32)}`,
} as const;
const opened = `Arbitrum.Portal.send({ token: USDC, amount: 2 }).refundee(${AT}).receive({ token: USDC, amount: 1 })`;

/** The program and every intent it opens, but where each is written. */
const same = (a: CompiledSauceProgram, b: CompiledSauceProgram): void => {
  expect(bytesToHex(a.bytecode)).toBe(bytesToHex(b.bytecode));
  const unplaced = (program: CompiledSauceProgram) =>
    program.intents.map(({ span: _, ...rest }) => rest);
  expect(unplaced(a)).toEqual(unplaced(b));
};

describe("an ABI binding given in `contracts`", () => {
  const given = (body: string) =>
    compileSauceProgram("base", `function main() {\n  ${body}\n}\n`, {
      contracts: { Grid: { abi: ABI } },
      intents: INTENTS,
    });
  const imported = (body: string) =>
    compileSauceProgram(
      "base",
      `import Grid from "./Grid.json";\n\nfunction main() {\n  ${body}\n}\n`,
      {
        resolve: (path) =>
          path === "./Grid.json" ? new TextEncoder().encode(JSON.stringify(ABI)) : undefined,
        intents: INTENTS,
      },
    );

  // Pending the compiler: a closure compiled as a program of its own does not see the entry's
  // `inlineContracts`, as it sees an import of the same ABI.
  it.failing("reaches a `.then(...)` body, as an import of the same ABI does", () => {
    const body = `${opened}.then(() => { Grid.at(${AT}).poke(1); });`;
    same(given(body), imported(body));
  });

  // Pending the compiler, as above, and `await x;` as `x.then(() => { … })`.
  it.failing("reaches what follows an `await`, and a body nested in a body", () => {
    same(
      given(`await ${opened};\n  Grid.at(${AT}).poke(1);`),
      given(`${opened}.then(() => { Grid.at(${AT}).poke(1); });`),
    );
    const nested = `${opened}.then(() => {
    Optimism.Portal.send({ token: USDC, amount: 1 }).refundee(${AT}).receive()
      .then(() => { Grid.at(${AT}).poke(2); });
  });`;
    same(given(nested), imported(nested));
  });
});

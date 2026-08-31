/**
 * E4.2 universal deposit adapter — real-compile tests. Uses the ordinary
 * `@eco-incorp/sauce-compiler`, no forge/fork/anvil. Same import + baseDirs pattern as
 * `swap.compile.test.ts`.
 */
import { compileProgram as compile } from "./helpers";

import { DEPOSIT_BASE_DIRS, depositSource } from "../src/deposit/source.js";
import type { DepositKey } from "../src/deposit/templates.js";
import type { DepositSourceSpec } from "../src/deposit/types.js";

const TARGET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

function specFor(key: DepositKey): DepositSourceSpec {
  const [protocol, action] = key.split(":") as [string, string];
  switch (key) {
    case "weth:wrap":
    case "lido:stake":
      return { protocol, action, target: TARGET, amount: 1_000n };
    case "weth:unwrap":
      return { protocol, action, target: TARGET, amount: 1_000n };
    default:
      return { protocol, action, target: TARGET, token: TOKEN, amount: 1_000n };
  }
}

const ALL_KEYS: DepositKey[] = [
  "weth:wrap",
  "weth:unwrap",
  "aave-v3:supply",
  "aave-v3:withdraw",
  "spark:supply",
  "spark:withdraw",
  "compound-v3:supply",
  "euler-v2:deposit",
  "erc4626:deposit",
  "lido:stake",
  "lido:wrap",
];

describe("deposit adapter compiles for every registered template, both targets", () => {
  for (const key of ALL_KEYS) {
    for (const target of ["v1", "v12"] as const) {
      it(`${key} / ${target}`, () => {
        const { bytecode } = compile(depositSource(specFor(key)), {
          baseDirs: [...DEPOSIT_BASE_DIRS],
          target,
          treeshake: true,
        });
        expect(bytecode[0]!.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("amount 'balance' variants compile", () => {
  it("an ERC20 template (aave-v3:supply)", () => {
    const { bytecode } = compile(
      depositSource({ protocol: "aave-v3", action: "supply", target: TARGET, token: TOKEN, amount: "balance" }),
      { baseDirs: [...DEPOSIT_BASE_DIRS], target: "v12", treeshake: true },
    );
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a native-value template (weth:wrap)", () => {
    const { bytecode } = compile(
      depositSource({ protocol: "weth", action: "wrap", target: TARGET, amount: "balance" }),
      { baseDirs: [...DEPOSIT_BASE_DIRS], target: "v1", treeshake: true },
    );
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("a multi-deposit program (erc4626 + aave-v3, one main())", () => {
  for (const target of ["v1", "v12"] as const) {
    it(`compiles on ${target}`, () => {
      const src = depositSource([
        { protocol: "erc4626", action: "deposit", target: TARGET, token: TOKEN, amount: 500n },
        { protocol: "aave-v3", action: "supply", target: TARGET, token: TOKEN, amount: 500n },
      ]);
      const { bytecode } = compile(src, { baseDirs: [...DEPOSIT_BASE_DIRS], target, treeshake: true });
      expect(bytecode[0]!.length).toBeGreaterThan(0);
    });
  }
});

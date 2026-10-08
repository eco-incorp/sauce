/**
 * `sauce run --fund`, in process: reading `--fund`, and the wrapper the funded program compiles as.
 * Executing it — the pulls, the prompts, the sweep — is `cli-funding.e2e.test.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, toFunctionSelector } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { UsageError } from "../src/cli/args.js";
import { baseUnits, parseFund, thenForm, wrapProgram } from "../src/cli/funding.js";
import { assumedBalances } from "../src/cli/inputs.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { Permit2ABI } from "../src/protocols/permit2/abis.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { TOKEN_REGISTRY } from "../src/routes/token-registry.js";

const base = requireChain("base");
const solana = requireChain("solana");
const BASE_USDC = getAddress(
  TOKEN_REGISTRY[base.id]!.find((row) => row.symbol === "USDC")!.address,
);
const TOKEN = "0x1111111111111111111111111111111111111111";

describe("--fund <TOKEN|address>:<amount>", () => {
  it("reads a registered symbol in whole tokens, by the registry's decimals", () => {
    expect(parseFund("USDC:1.5", base)).toEqual({
      raw: "USDC:1.5",
      token: BASE_USDC,
      label: "USDC",
      decimals: 6,
      amount: { units: "1.5" },
      flag: "--fund",
    });
    // The symbol in any case, as the program names it.
    expect(parseFund("usdc:2", base).token).toBe(BASE_USDC);
  });

  it("reads a stock token's symbol, which is its issuer's ticker and not uppercase", () => {
    const spcx = getAddress(
      TOKEN_REGISTRY[base.id]!.find((row) => row.symbol === "SPCXc")!.address,
    );
    for (const raw of ["SPCXc:1", "spcxc:1", "SPCXC:1"]) {
      expect(parseFund(raw, base)).toMatchObject({ token: spcx, label: "SPCXc", decimals: 8 });
    }
  });

  it("reads base units from an amount ending in n, as a JavaScript bigint is written", () => {
    expect(parseFund("USDC:1500000n", base).amount).toEqual({ base: 1_500_000n });
    expect(parseFund(`${TOKEN}:1500000n`, base).amount).toEqual({ base: 1_500_000n });
  });

  it("is exact in whole tokens through the token's decimals, and base units as given", async () => {
    const at = async (raw: string) => baseUnits(undefined as never, parseFund(raw, base));
    expect(await at("USDC:1.5")).toEqual({ amount: 1_500_000n });
    expect(await at("ETH:0.000000000000000001")).toEqual({ amount: 1n });
    expect(await at("USDC:1500000n")).toEqual({ amount: 1_500_000n });
  });

  // A program's integers are base units, so a bare integer of whole tokens that reads like them is
  // said — not refused: it may be meant.
  it("says when a bare integer of whole tokens reads like base units, at 10^decimals and up", async () => {
    const at = async (raw: string) => baseUnits(undefined as never, parseFund(raw, base));
    expect(await at("USDC:1500000")).toEqual({
      amount: 1_500_000_000_000n,
      note: "--fund USDC:1500000: that is 1.5 million USDC; for base units write 1500000n",
    });
    expect((await at("USDC:1000000")).note).toBeDefined();
    // Below 10^decimals, with a decimal point, or in base units: nothing to say.
    for (const raw of ["USDC:999999", "USDC:1500000.5", "USDC:1500000n", "ETH:2", "SPCXc:150"]) {
      expect((await at(raw)).note).toBeUndefined();
    }
    const assumed = assumedBalances(["USDC:2000000"], base)[0]!;
    expect((await baseUnits(undefined as never, assumed)).note).toBe(
      "--assume-balance USDC:2000000: that is 2 million USDC; for base units write 2000000n",
    );
  });

  it("takes a token by address, its decimals left to the token", () => {
    const fund = parseFund(`${TOKEN.toUpperCase().replace("0X", "0x")}:3`, base);
    expect(fund.token).toBe(getAddress(TOKEN));
    expect(fund.decimals).toBeUndefined();
  });

  it("names the chain's native currency ETH or native, with 18 decimals and no token", () => {
    for (const raw of ["ETH:0.01", "native:0.01", "eth:10000000000000000n"]) {
      const fund = parseFund(raw, base);
      expect(fund.token).toBeUndefined();
      expect(fund.decimals).toBe(18);
    }
  });

  it.each([
    ["USDC", "expected <TOKEN|address>:<amount>"],
    [":1", "expected <TOKEN|address>:<amount>"],
    ["USDC:", "expected <TOKEN|address>:<amount>"],
    ["USDC:-1", "'-1' is not an amount"],
    ["USDC:1e6", "'1e6' is not an amount"],
    ["USDC:0x10", "'0x10' is not an amount"],
    ["NOPE:1", "NOPE is not a token base registers"],
  ])("refuses %s", (raw, message) => {
    expect(() => parseFund(raw, base)).toThrow(UsageError);
    expect(() => parseFund(raw, base)).toThrow(message);
  });

  it("refuses off EVM, where a program spends from the accounts it is given", () => {
    expect(() => parseFund("USDC:1", solana)).toThrow("--fund is for EVM chains");
  });
});

describe("sauce run --fund, refused before anything is sent", () => {
  const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  let work: string;
  let program: string;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-funding-"));
    program = join(work, "pay.sauce.ts");
    writeFileSync(program, "transfer(USDC, 0x6666666666666666666666666666666666666666n, 1n);\n");
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** `sauce run` against an endpoint nothing listens on: a refusal must come before it is reached. */
  async function run(...flags: string[]): Promise<{ code: number; stderr: string }> {
    return command("run", ...flags);
  }

  async function command(
    name: string,
    ...flags: string[]
  ): Promise<{ code: number; stderr: string }> {
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: () => undefined,
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(
      [name, program, "--rpc-url", "http://127.0.0.1:9", "--private-key", OWNER_KEY, ...flags],
      io,
    );

    return { code, stderr };
  }

  it("permit2 on a chain whose registry records no Permit2", async () => {
    // Linea is a preview chain, which `run` refuses before its funding; `simulate` takes --fund
    // there, and refuses the mode just as early.
    expect((await run("--chain", "linea", "--fund", `${TOKEN}:1`)).stderr).toMatch(
      /linea \(Linea, chain id 59144\), a preview chain/,
    );
    const refused = await command("simulate", "--chain", "linea", "--fund", `${TOKEN}:1`);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "Permit2 is not registered on linea: fund with --fund-mode permit, allowance or transfer",
    );
  });

  // Every `await` the compiler refuses reaches it as written: the program compiles as the user
  // wrote it before any funding wraps it, and `thenForm` leaves such a program untouched.
  const hop =
    "Ethereum.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: to })";
  it.each([
    [
      "in an `if` with a statement after it",
      [`  if (amount > 1) {`, `    await ${hop};`, "  }"],
      "a statement after an `if` whose branches `await`",
      "5:3",
    ],
    [
      "in a loop",
      ["  for (let i = 0; i < 2; i += 1) {", `    await ${hop};`, "  }"],
      "an `await` inside a loop",
      "3:5",
    ],
    ["used as a value", [`  const x = await ${hop};`], "an `await` used as a value", "2:13"],
    [
      "followed by a value `return`",
      [`  await ${hop};`, "  USDC.transfer(to, amount);", "  return amount;"],
      "a value `return` after an `await`",
      "4:3",
    ],
    [
      "in a `try` with a statement after it",
      [
        "  try {",
        `    await ${hop};`,
        "  } catch (e) {",
        "    USDC.transfer(to, 1);",
        "  }",
        "  USDC.transfer(to, 2);",
      ],
      "a statement after a `try` that awaits",
      "7:3",
    ],
  ])(
    "--fund on a program with an `await` %s: the compiler's refusal, at the file's line",
    async (_name, lines, words, at) => {
      const file = join(work, "awaits.sauce.ts");
      writeFileSync(
        file,
        [
          "function main(to: Address, amount: Uint256): Uint256 {",
          ...lines,
          "  return 0;",
          "}",
          "",
        ].join("\n"),
      );
      let stderr = "";
      const code = await runCli(
        [
          ...["run", file, "--chain", "base", "--rpc-url", "http://127.0.0.1:9"],
          ...["--private-key", OWNER_KEY, "--fund", "USDC:1", "--intent-execution-fee", "0"],
          ...["--args", "0x6666666666666666666666666666666666666666", "5"],
        ],
        { ...nodeIo(), stdout: () => undefined, stderr: (text) => void (stderr += text) },
      );
      expect(code).toBe(1);
      expect(stderr).toContain(words);
      expect(stderr).toContain(`--> ${file}:${at}`);
      expect(stderr).not.toContain("main.js");
    },
  );

  it("--fund on Solana", async () => {
    const refused = await run("--chain", "solana", "--fund", "USDC:1");
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "--fund is for EVM chains: on solana a program spends from the accounts it is given",
    );
  });

  it("--fund on sauce tx, which signs nothing", async () => {
    let stderr = "";
    const code = await runCli(
      [
        "tx",
        program,
        "--chain",
        "base",
        "--owner",
        getAddress(TOKEN),
        "--value",
        "0",
        "--fund",
        "USDC:1",
      ],
      { ...nodeIo(), stdout: () => undefined, stderr: (text) => void (stderr += text) },
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/--fund/);
  });
});

describe("Permit2's errors, which a refused pull reverts with", () => {
  // The registry declares them so `sauce run` names a revert (`InvalidNonce()`); each must be one the
  // deployed Permit2 can raise: its selector is pushed in the canonical runtime, read from Ethereum.
  const runtime = (
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "fixtures/cli/Permit2.json"),
        "utf8",
      ),
    ) as { runtime: string }
  ).runtime.toLowerCase();
  const errors = Permit2ABI.filter((item) => item.type === "error");

  it.each(errors.map((error) => [error.name, error] as const))(
    "%s is in Permit2's code",
    (_, error) => {
      const signature = `${error.name}(${error.inputs.map((input) => input.type).join(",")})`;
      // Permit2's compiler pushes an error's selector left-aligned, as one 32-byte word.
      expect(runtime).toContain(`7f${toFunctionSelector(signature).slice(2)}${"00".repeat(28)}`);
    },
  );

  it("declares every one SignatureTransfer and AllowanceTransfer raise", () => {
    expect(errors.map((error) => error.name).sort()).toEqual(
      [
        "AllowanceExpired",
        "ExcessiveInvalidation",
        "InsufficientAllowance",
        "InvalidAmount",
        "InvalidContractSignature",
        "InvalidNonce",
        "InvalidSignature",
        "InvalidSignatureLength",
        "InvalidSigner",
        "LengthMismatch",
        "SignatureExpired",
      ].sort(),
    );
  });
});

describe("the funding wrapper", () => {
  const PULL =
    "__sauce_fund_pull(0x1111111111111111111111111111111111111111n, 0x2n, ctx.self(), 5n);";
  const IMPORTS = new Set(["transferFrom as __sauce_fund_pull"]);
  const compiles = (text: string): void => {
    expect(compileSauceProgram(base, text, { defines: {} }).bytecode.length).toBeGreaterThan(0);
  };

  it("wraps a program that awaits an intent in its `.then` form: the sweep runs where it opens", () => {
    const opened =
      "Arbitrum.hop({ send: { token: USDC, amount: 2 }, receive: { token: USDC, amount: 1 }, refundee: 0x66, fee: 0 })";
    const intents = { deadline: 2_000_000_000n, salt: `0x${"5a".repeat(32)}` } as const;
    for (const source of [
      `await ${opened};\nUSDC.transfer(0x66, 1);\n`,
      `async function main(to: Address) {\n  await ${opened};\n  USDC.transfer(to, 1);\n}\n`,
    ]) {
      const wrapped = wrapProgram(source, IMPORTS, [PULL], ["// sweep"]);
      expect(wrapped).not.toMatch(/\bawait\b/);
      // The sweep follows the statement that opens the intent, not the body.
      expect(wrapped.indexOf("// sweep")).toBeGreaterThan(wrapped.indexOf("}).then"));
      expect(compileSauceProgram(base, wrapped, { defines: {}, intents }).bodies).toHaveLength(1);
    }
  });

  it("leaves a program untouched where the compiler refuses one of its `await`s", () => {
    const hop =
      "Arbitrum.hop({ send: { token: USDC, amount: 2 }, receive: { token: USDC, amount: 1 }, refundee: to, fee: 0 })";
    const main = (...body: string[]) =>
      [
        "function main(to: Address, amount: Uint256): Uint256 {",
        ...body,
        "  return 0;",
        "}",
        "",
      ].join("\n");
    for (const source of [
      main("  if (amount > 1) {", `    await ${hop};`, "  }"),
      main("  for (let i = 0; i < 2; i += 1) {", `    await ${hop};`, "  }"),
      main("  {", `    await ${hop};`, "  }"),
      main(`  const x = await ${hop};`),
      main(`  await ${hop};`, "  USDC.transfer(to, amount);", "  return amount;"),
      main("  try {", `    await ${hop};`, "  } catch (e) {}", "  USDC.transfer(to, 2);"),
      main("  try {", "    USDC.transfer(to, 1);", "  } catch (e) {", `    await ${hop};`, "  }"),
      `function helper(to: Address) {\n  await ${hop};\n}\n${main("  helper(to);")}`,
      // A statement after an `if` whose branch awaits would run wherever the branch continued.
      `function main(to: Address) {\n  if (to != 0) {\n    await ${hop};\n  }\n  USDC.transfer(to, 2);\n}\n`,
    ]) {
      expect(thenForm(source)).toBe(source);
    }
  });

  it("moves nothing: the user's statements keep their lines", () => {
    const source = [
      "function main(to: Address, amount: Uint256) {",
      "  await Arbitrum.hop({ send: { token: USDC, amount }, refundee: to, fee: 0 });",
      "  USDC.transfer(to, amount); // on Arbitrum",
      "  await Optimism.hop({ send: { token: USDC, amount }, refundee: to, fee: 0 });",
      "  USDC.transfer(to, 1);",
      "}",
      "",
    ].join("\n");
    const written = thenForm(source).split("\n");
    expect(written).toHaveLength(source.split("\n").length);
    expect(written[2]).toContain("USDC.transfer(to, amount); // on Arbitrum");
    expect(written[4]).toContain("USDC.transfer(to, 1);");
    // The `await`s are blanked where they stood, not reprinted.
    expect(written[1]!.indexOf("Arbitrum.hop(")).toBe(
      source.split("\n")[1]!.indexOf("Arbitrum.hop("),
    );
  });

  it("an `await` is its `.then` form, byte for byte, in a `try`, nested, and in an `if`'s branches", () => {
    const intents = { deadline: 2_000_000_000n, salt: `0x${"5a".repeat(32)}` } as const;
    const hop = (chain: string) =>
      `await ${chain}.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: to, fee: 0 });`;
    for (const source of [
      `function main(to: Address, amount: Uint256) {\n  ${hop("Arbitrum")}\n  USDC.transfer(to, amount);\n  ${hop("Optimism")}\n  USDC.transfer(to, 1);\n}\n`,
      `function main(to: Address, amount: Uint256) {\n  try {\n    ${hop("Arbitrum")}\n    USDC.transfer(to, amount);\n    ${hop("Optimism")}\n    USDC.transfer(to, 1);\n  } catch (e) {\n    USDC.transfer(to, e.length);\n  }\n}\n`,
      // In the branches of an `if` that ends the body: each branch's rest is its own `.then`.
      `function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, 3);\n  if (amount > 1) {\n    ${hop("Arbitrum")}\n    USDC.transfer(to, amount);\n  } else if (amount == 1) {\n    ${hop("Optimism")}\n    USDC.transfer(to, 1);\n  } else {\n    USDC.transfer(to, 2);\n  }\n}\n`,
      `function main(to: Address, amount: Uint256) {\n  try {\n    if (amount > 1) ${hop("Arbitrum")}\n  } catch (e) {\n    USDC.transfer(to, e.length);\n  }\n}\n`,
    ]) {
      const written = thenForm(source);
      expect(written).not.toMatch(/\bawait\b/);
      expect(compileSauceProgram(base, written, { defines: {}, intents }).bytecode).toEqual(
        compileSauceProgram(base, source, { defines: {}, intents }).bytecode,
      );
    }
  });

  it("wraps a script: the pulls run before its statements and the sweeps after them", () => {
    const wrapped = wrapProgram("USDC.transfer(0x2n, 5n);\n", IMPORTS, [PULL], ["// sweep"]);
    expect(wrapped).toBe(
      [
        'import { transferFrom as __sauce_fund_pull } from "@sauce/token";',
        PULL,
        "USDC.transfer(0x2n, 5n);",
        "// sweep",
        "",
      ].join("\n"),
    );
    expect(wrapped).not.toContain("function main");
    compiles(wrapped);
  });

  it("keeps a script's imports ahead of the pulls, where the compiler takes them", () => {
    const source = [
      'import { balanceOf } from "@sauce/token";',
      "",
      "function half(x: Uint256): Uint256 {",
      "  return x / 2n;",
      "}",
      "",
      "require(half(balanceOf(USDC, ctx.self())) > 0n);",
      "",
    ].join("\n");
    const wrapped = wrapProgram(source, IMPORTS, [PULL], []);
    expect(wrapped.split("\n").slice(0, 3)).toEqual([
      'import { transferFrom as __sauce_fund_pull } from "@sauce/token";',
      'import { balanceOf } from "@sauce/token";',
      PULL,
    ]);
    compiles(wrapped);
  });

  it("keeps a typed main's parameters and return, and passes the arguments through", () => {
    const source = [
      'import { balanceOf } from "@sauce/token";',
      "",
      "function share(amount: Uint256, parts: Uint256): Uint256 {",
      "  return amount / parts;",
      "}",
      "",
      "function main(token: Address, recipients: Address[], amount: Uint256): Uint256 {",
      "  for (let i = 0; i < recipients.length; i = i + 1) {",
      "    transfer(token, recipients[i], share(amount, recipients.length));",
      "  }",
      "  return balanceOf(token, ctx.self());",
      "}",
      "",
    ].join("\n");
    const wrapped = wrapProgram(source, IMPORTS, [PULL], ["// sweep"]);
    expect(wrapped).toContain(
      "function main(token: Address, recipients: Address[], amount: Uint256): Uint256 {",
    );
    expect(wrapped).toContain("const __sauce_result = __sauce_program(token, recipients, amount);");
    expect(wrapped).toMatch(/\/\/ sweep\n {2}return __sauce_result;\n\}/);
    const program = compileSauceProgram(base, wrapped, { defines: {} });
    // The wrapper takes exactly the arguments the program did.
    expect(program.entryParams).toEqual(
      compileSauceProgram(base, source, { defines: {} }).entryParams,
    );
  });

  it("keeps every helper beside the program, and renames only main", () => {
    const source = [
      "function half(x: Uint256): Uint256 {",
      "  return x / 2n;",
      "}",
      "",
      "function pay(token: Address, to: Address, amount: Uint256): void {",
      "  transfer(token, to, amount);",
      "}",
      "",
      "function main(token: Address, to: Address, amount: Uint256) {",
      "  pay(token, to, half(amount));",
      "}",
      "",
    ].join("\n");
    const wrapped = wrapProgram(source, IMPORTS, [PULL], []);
    expect(wrapped).toContain("function half(x: Uint256): Uint256 {\n  return x / 2n;\n}");
    expect(wrapped).toContain("function pay(token: Address, to: Address, amount: Uint256): void {");
    expect(wrapped).toContain(
      "function __sauce_program(token: Address, to: Address, amount: Uint256): void {\n" +
        "  pay(token, to, half(amount));\n}",
    );
    expect(wrapped.match(/function main\(/g)).toHaveLength(1);
    expect(wrapped).toMatch(/\n {2}__sauce_program\(token, to, amount\);\n\}\n$/);
    compiles(wrapped);
  });

  it("calls a void main without capturing a result", () => {
    const wrapped = wrapProgram("function main(amount: Uint256): void {\n}\n", IMPORTS, [PULL], []);
    expect(wrapped).toContain("function main(amount: Uint256): void {");
    expect(wrapped).toContain("  __sauce_program(amount);\n}");
    compiles(wrapped);
  });

  // A helper with no annotation must return a value; `main` need not. So an unannotated `main` that
  // returns nothing is declared `: void` once renamed, and one that returns a value is left as is.
  it.each([
    ["returns nothing", "function main() {\n  USDC.transfer(0x2n, 5n);\n  return;\n}\n", false],
    ["returns a value", "function main() {\n  return USDC;\n}\n", true],
    [
      "returns only inside an intent's closure",
      "function main() {\n  const f = () => {\n    return 1n;\n  };\n}\n",
      false,
    ],
  ])("wraps an unannotated main that %s", (_, source, value) => {
    const wrapped = wrapProgram(source, IMPORTS, [PULL], []);
    expect(wrapped).toContain(
      value ? "function __sauce_program() {" : "function __sauce_program(): void {",
    );
    expect(wrapped).toContain(
      value ? "const __sauce_result = __sauce_program();" : "  __sauce_program();\n",
    );
    if (!source.includes("=>")) compiles(wrapped);
  });

  it("leaves a `main` inside a string or a property alone", () => {
    const source = 'const NOTE = "function main() {}";\nfunction main() {\n  ctx.main;\n}\n';
    const wrapped = wrapProgram(source, IMPORTS, [PULL], []);
    expect(wrapped).toContain('const NOTE = "function main() {}";');
    expect(wrapped.match(/function __sauce_program\(/g)).toHaveLength(1);
  });
});

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
import { parseFund, wrapProgram } from "../src/cli/funding.js";
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
  it("reads a registered symbol in whole units, by the registry's decimals", () => {
    expect(parseFund("USDC:1.5", base)).toEqual({
      raw: "USDC:1.5",
      token: BASE_USDC,
      label: "USDC",
      decimals: 6,
      amount: { units: "1.5" },
    });
    // The symbol in any case, as the program names it.
    expect(parseFund("usdc:2", base).token).toBe(BASE_USDC);
  });

  it("reads base units from an amount ending in n, as SauceScript writes an integer", () => {
    expect(parseFund("USDC:1500000n", base).amount).toEqual({ base: 1_500_000n });
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

  it("registers no symbol off EVM", () => {
    expect(() => parseFund("USDC:1", solana)).toThrow("USDC is not a token solana registers");
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
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: () => undefined,
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(
      ["run", program, "--rpc-url", "http://127.0.0.1:9", "--private-key", OWNER_KEY, ...flags],
      io,
    );

    return { code, stderr };
  }

  it("permit2 on a chain whose registry records no Permit2", async () => {
    const refused = await run("--chain", "linea", "--fund", `${TOKEN}:1`);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "Permit2 is not registered on linea: fund with --fund-mode permit, allowance or transfer",
    );
  });

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

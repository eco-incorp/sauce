/**
 * `sauce where`: one program compiled for many chains, with nothing reached — the chains it
 * compiles on with its size, and the ones it does not, grouped by the reason.
 */
import { readFileSync } from "node:fs";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { whereCommand } from "../src/cli/where.js";

const files = nodeIo();
const file = "../docs/examples/pay.sauce.ts";
const text = readFileSync(file, "utf8");

describe("sauce where", () => {
  it("lists the chains a program compiles on, and why the others refuse", () => {
    const out = whereCommand({ file, text }, files);
    const json = out.json as {
      compiles: number;
      chains: { chain: string; compiles: boolean; reason?: string }[];
    };
    const by = new Map(json.chains.map((each) => [each.chain, each]));
    expect(by.get("base")).toMatchObject({ compiles: true });
    expect(by.get("solana")?.compiles).toBe(true);
    expect(by.get("bsc")).toMatchObject({ compiles: false, reason: "`USDC` is not a token there" });
    expect(out.text).toMatch(/✓ base +evm {2}supported {2}\d+ bytes/);
    expect(out.text).toMatch(/✗ `USDC` is not a token there \(\d+\): .*bsc/);
  });

  it("takes the chains named, or only the supported ones", () => {
    const some = whereCommand(
      { file, text, chains: [requireChain("base"), requireChain("bsc")] },
      files,
    ).json as { compiles: number; chains: unknown[] };
    expect(some).toMatchObject({ compiles: 1 });
    expect(some.chains).toHaveLength(2);
    const supported = whereCommand({ file, text, supported: true }, files).json as {
      chains: { support: string }[];
    };
    expect(supported.chains.every((each) => each.support === "supported")).toBe(true);
  });

  it("gives the compiler's own cause, not its generic wrapper", () => {
    const bad = 'function main() {\n  require(nope > 0, "x");\n}\n';
    const out = whereCommand({ file, text: bad, chains: [requireChain("base")] }, files);
    const json = out.json as { chains: { compiles: boolean; reason?: string }[] };
    expect(json.chains[0]?.compiles).toBe(false);
    expect(json.chains[0]?.reason).not.toMatch(/compiling the program failed/);
    expect(json.chains[0]?.reason).toMatch(/nope/);
    expect(out.text).toMatch(/nope/);
  });

  it("names a missing import in the compiler's own cause", () => {
    const bad =
      'import { nope } from "./not-there.js";\nfunction main(): Uint256 {\n  return nope();\n}\n';
    const out = whereCommand(
      { file: "probe.sauce.ts", text: bad, chains: [requireChain("base")] },
      files,
    );
    expect(out.text).toContain('failed to import module "./not-there.js"');
  });

  it("gives the construct the compiler refuses, from its diagnostics, not a count of them", () => {
    const bad =
      "function main(): Uint256 {\n  const f = () => 1;\n  const g = () => 2;\n  return f() + g();\n}\n";
    const out = whereCommand({ file, text: bad, chains: [requireChain("base")] }, files);
    const json = out.json as { chains: { compiles: boolean; reason?: string }[] };
    expect(json.chains[0]?.compiles).toBe(false);
    const reason = json.chains[0]?.reason ?? "";
    expect(reason).not.toMatch(/unsupported construct/);
    expect(reason).toMatch(/^an arrow function cannot be used as a value/);
    // The whole first sentence: the `{ ... }` inside it does not end it.
    expect(reason).toMatch(/and call it by name$/);
  });

  it("keeps the SDK's own reason, though the compiler's error is its cause", () => {
    const bad = "function main(to: Address) {\n  FOOBAR.transfer(to, 1);\n}\n";
    const out = whereCommand({ file, text: bad, chains: [requireChain("base")] }, files);
    const json = out.json as { chains: { reason?: string }[] };
    expect(json.chains[0]?.reason).toBe("`FOOBAR` is not a token or protocol there");
  });

  it("refuses the chains a // @target header rules out, as compile does", () => {
    type Out = { chains: { chain: string; compiles: boolean; reason?: string }[] };
    const chains = [requireChain("base"), requireChain("solana")];
    const evm = whereCommand({ file, text: `// @target evm\n${text}`, chains }, files).json as Out;
    expect(evm.chains[0]).toMatchObject({ chain: "base", compiles: true });
    expect(evm.chains[1]).toMatchObject({
      chain: "solana",
      compiles: false,
      reason: "the file's `// @target evm` does not match SVM chains",
    });
    const svm = whereCommand({ file, text: `// @target svm\n${text}`, chains }, files).json as Out;
    expect(svm.chains[0]).toMatchObject({
      chain: "base",
      compiles: false,
      reason: "the file's `// @target svm` does not match EVM chains",
    });
    expect(svm.chains[1]).toMatchObject({ chain: "solana", compiles: true });
  });
});

describe("sauce where from the command line", () => {
  it("refuses an actions document instead of reporting that it compiles on no chain", async () => {
    const document = JSON.stringify({
      version: 1,
      actions: [
        { type: "argument", name: "amount" },
        {
          type: "uniswapV3Swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          factory: "UniswapV3.Factory",
          fee: 500,
          amountOutMin: "1",
          recipient: "pot",
        },
      ],
    });
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      readText: () => document,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(["--no-update-check", "where", "swap-by-key.json"], io);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    const message =
      "swap-by-key.json is an actions document: sauce where takes a SauceScript program; " +
      "compile a document with sauce compile <file> --chain <slug>";
    expect(stderr).toBe(`sauce where: ${message}\nRun \`sauce where --help\` for usage.\n`);
  });
});

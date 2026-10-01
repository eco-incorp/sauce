/**
 * The `sauce` command with an actions document: `sauce actions` prints the SauceScript a document
 * lowers to on a chain and its bytecode, and `compile`/`tx` take the document wherever they take a
 * `.sauce.ts` file. Driven in-process through the built bin's `runCli`, offline: no command here is
 * given an endpoint. Here rather than beside the SDK's CLI suites because the command loads this
 * package's build, which the SDK's tests run before.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToHex, getAddress } from "viem";

import { actionsCommand } from "../../sdk/dist/cli/actions.js";
import { nodeIo, runCli, type CliIo } from "../../sdk/dist/cli/run.js";
import { v12EngineAddress } from "../../sdk/dist/deployments/index.js";
import { v12Pot } from "../../sdk/dist/evm/engine.js";
import { compileProgram } from "../src/index.js";
import type { ActionProgram } from "../src/types.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/** USDC for WETH through the pool Uniswap V3's factory keys at 0.05%, the amount an argument. */
const SWAP = {
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
      recipient: "self",
    },
  ],
} as const;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  return sauceWith({}, ...argv);
}

/** `sauce` with some of its io replaced: stdin, for one. */
async function sauceWith(overrides: Partial<CliIo>, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    run: () => 0,
    ...overrides,
  };
  const code = await runCli(argv, io);

  return { code, stdout, stderr };
}

let work: string;
const file = (name: string, value: unknown): string => {
  const path = join(work, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));

  return path;
};
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-actions-cli-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const compiled = (chain: string) => compileProgram(SWAP as unknown as ActionProgram, { chain });

describe("sauce actions", () => {
  it("prints the source the document lowers to, main's parameters and the bytecode", async () => {
    const run = await sauce("actions", file("swap.json", SWAP), "--chain", "base");
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /^\/\/ .*swap\.json, lowered for base \(chain 8453\)\n/);
    assert.match(run.stdout, /const pool\d+ = UniswapV3\.Factory\.getPool\(USDC, WETH, 500n\);/);
    assert.match(run.stdout, /\/\/ main\(a_amount: Uint256\): pass the arguments in this order/);
    const program = compiled("base");
    assert.ok(
      run.stdout
        .trimEnd()
        .endsWith(`// bytecode, ${program.bytecode.length} bytes: ${bytesToHex(program.bytecode)}`),
    );
    assert.ok(run.stdout.includes(program.source.trimEnd()), "the source compileProgram compiles");
  });

  it("compiles one document for each chain it names, from the same source", async () => {
    const path = file("swap.json", SWAP);
    const [ethereum, base] = await Promise.all(
      ["ethereum", "base"].map(async (chain) => {
        const run = await sauce("actions", path, "--chain", chain, "--json");
        assert.equal(run.code, 0, run.stderr);

        return JSON.parse(run.stdout) as Record<string, unknown>;
      }),
    );
    assert.equal(ethereum!.source, base!.source);
    assert.notEqual(ethereum!.bytecode, base!.bytecode);
    assert.equal(ethereum!.bytecode, bytesToHex(compiled("ethereum").bytecode));
    assert.equal(base!.chainId, 8453);
    assert.deepEqual(base!.parameters, ["amount"]);
    assert.deepEqual(base!.entryParams, [{ name: "a_amount", type: "Uint256" }]);
    assert.deepEqual(base!.document, SWAP, "the document as parsed, every name as written");
  });

  it("reads a document from stdin for -, as it reads the file", async () => {
    const piped = { readStdin: () => JSON.stringify(SWAP) };
    for (const command of ["actions", "compile"]) {
      const fromFile = await sauce(command, file("swap.json", SWAP), "--chain", "base", "--json");
      const fromStdin = await sauceWith(piped, command, "-", "--chain", "base", "--json");
      assert.equal(fromStdin.code, 0, fromStdin.stderr);
      const bytecode = (run: Run) => (JSON.parse(run.stdout) as { bytecode: string }).bytecode;
      assert.equal(bytecode(fromStdin), bytecode(fromFile), command);
    }
  });

  it("is the one function the MCP server calls: actionsCommand", async () => {
    const text = JSON.stringify(SWAP);
    const output = await actionsCommand({ file: "<document>", text, chain: "base" });
    const run = await sauce("actions", file("swap.json", SWAP), "--chain", "base", "--json");
    const { compiler: _a, ...fromCli } = JSON.parse(run.stdout) as Record<string, unknown>;
    const { compiler: _b, ...fromFunction } = JSON.parse(JSON.stringify(output.json)) as Record<
      string,
      unknown
    >;
    assert.deepEqual(fromFunction, fromCli);
  });

  it("refuses a name the chain lacks, naming the chain, the name and its path", async () => {
    const run = await sauce("actions", file("swap.json", SWAP), "--chain", "avalanche");
    assert.equal(run.code, 1);
    assert.match(run.stderr, /swap\.json does not compile for avalanche:\n/);
    assert.match(
      run.stderr,
      / {2}actions\[1\]\.tokenIn: no token "USDC" on Avalanche C-Chain \(chain 43114\)/,
    );
  });

  it("needs --chain for a document with no chainId, and takes a document's own", async () => {
    const missing = await sauce("actions", file("swap.json", SWAP));
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /missing --chain <slug\|id>: .*swap\.json has no chainId/);

    const pinned = file("pinned.json", { ...SWAP, chainId: 8453 });
    const own = await sauce("actions", pinned, "--json");
    assert.equal(own.code, 0, own.stderr);
    assert.equal(
      (JSON.parse(own.stdout) as { bytecode: string }).bytecode,
      bytesToHex(compiled("base").bytecode),
    );
    const other = await sauce("actions", pinned, "--chain", "ethereum");
    assert.equal(other.code, 1);
    assert.match(other.stderr, /chainId: the program is written for chain 8453, not Ethereum/);
  });

  it("lists every problem of an invalid document, with its path", async () => {
    const broken = {
      version: 1,
      actions: [{ ...SWAP.actions[1], amount: 5, fee: undefined, tokenIn: "usdc" }],
    };
    const run = await sauce("actions", file("broken.json", broken), "--chain", "base");
    assert.equal(run.code, 1);
    assert.match(run.stderr, /broken\.json is not a valid actions document:\n/);
    assert.match(run.stderr, / {2}actions\[0\]\.amount: expected a base-10 string/);
    assert.match(run.stderr, / {2}actions\[0\]\.tokenIn: .*did you mean "USDC"\?/);
    assert.match(run.stderr, / {2}actions\[0\]\.fee: missing: with `factory`, give `fee` too/);
  });

  it("is for actions documents: a SauceScript file, or defines, are refused", async () => {
    const script = await sauce("actions", file("pay.sauce.ts", "USDC.transfer(R, 1n);\n"));
    assert.equal(script.code, 2);
    assert.match(
      script.stderr,
      /is not an actions document .* compile a SauceScript file with `sauce compile`/,
    );
    const defined = await sauce(
      "compile",
      file("swap.json", SWAP),
      "--chain",
      "base",
      "--define",
      "X=1",
    );
    assert.equal(defined.code, 2);
    assert.match(defined.stderr, /an actions document's values are its own fields/);
  });
});

describe("an actions document wherever a program goes", () => {
  it("sauce compile compiles it as sauce actions does", async () => {
    const run = await sauce("compile", file("swap.json", SWAP), "--chain", "base");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.trim(), bytesToHex(compiled("base").bytecode));
  });

  it("sauce tx cooks it on the Pot, with its argument actions as main's --args", async () => {
    const run = await sauce(
      "tx",
      file("swap.json", SWAP),
      "--chain",
      "ethereum",
      "--owner",
      OWNER,
      "--value",
      "0",
      "--args",
      "1000000",
    );
    assert.equal(run.code, 0, run.stderr);
    const tx = JSON.parse(run.stdout) as { chainId: number; data: string };
    assert.equal(tx.chainId, 1);
    const payload = compiled("ethereum").payload({ amount: 1_000_000n });
    assert.equal(tx.data, v12Pot.encodeCook(getAddress(v12EngineAddress()), bytesToHex(payload)));
  });
});

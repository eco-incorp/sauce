/**
 * The `sauce` command, in process: its flags, what each command prints, and that it compiles a
 * file exactly as `compileSauceProgram` compiles it. Executing what it prints is `cli.e2e.test.ts`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer } from "node:http";
import { address as svmAddress, type Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  numberToHex,
  stringToBytes,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import {
  parseChain,
  parseDefines,
  parseDefinesFile,
  parseHeader,
  parseSalt,
  UsageError,
} from "../src/cli/args.js";
import { awaitPot, caughtUp, registeredBalances } from "../src/cli/chain.js";
import {
  chooseTerminal,
  confirmOn,
  type Terminal,
  type TerminalChoice,
} from "../src/cli/terminal.js";
import { castSend } from "../src/cli/commands.js";
import { PRICE_UNITS } from "../src/cli/price.js";
import {
  awaitAccount,
  failureReason,
  namingAccount,
  parseAccounts,
  resolveTokenAccounts,
} from "../src/cli/solana.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  v12DeployedAddresses,
  v12EngineAddress,
  v12KitchenAddress,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/kitchen.js";
import { potSalt, SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { v12Kitchen, v12Pot } from "../src/evm/engine.js";
import * as root from "../src/index.js";
import * as routes from "../src/routes/index.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";
import { svmTokenRows } from "../src/routes/token-registry.js";
import { TOKEN_2022_PROGRAM_ID } from "../src/svm/token-program.js";
import { encodeCompactArguments } from "../src/compact-arguments.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
/** OWNER's key: anvil's second account, public. */
const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x3333333333333333333333333333333333333333";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(SDK, "..", "package.json"), "utf8")) as {
  name: string;
  version: string;
};

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** What `io.run` was asked to execute. */
  readonly ran: ReadonlyArray<{ command: string; args: readonly string[]; cwd: string }>;
}

async function sauce(...argv: string[]): Promise<Run> {
  return sauceWith({}, ...argv);
}

/** `sauce` with `overrides` on the process io: stdin's text, a terminal to ask on. */
async function sauceWith(overrides: Partial<CliIo>, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const ran: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
  const io: CliIo = {
    ...nodeIo(),
    ...overrides,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    run: (command, args, cwd) => {
      ran.push({ command, args, cwd });

      return 0;
    },
  };
  const code = await runCli(argv, io);

  return { code, stdout, stderr, ran };
}

const json = (run: Run): Record<string, unknown> => {
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

let work: string;
const file = (name: string, text: string): string => {
  const path = join(work, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);

  return path;
};

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-cli-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const PAY = "USDC.transfer(RECIPIENT, AMOUNT);\nUSDT.transfer(RECIPIENT, AMOUNT);\n";
const PAY_DEFINES = [`--define`, `RECIPIENT=${RECIPIENT}`, `--define`, `AMOUNT=1000`];

describe("flags", () => {
  it("parses defines as the SDK takes them, refusing what the compiler would", () => {
    expect(parseDefines(["A=1_000n", "B=0xff", "C=true", "D=false"])).toEqual({
      A: 1000n,
      B: 255n,
      C: true,
      D: false,
    });
    expect(parseDefines([`R=${RECIPIENT}`])).toEqual({ R: BigInt(RECIPIENT) });
    for (const bad of ["A", "1A=1", "A=-1", "A=1.5", "A=x", `A=0x1${"0".repeat(64)}`]) {
      expect(() => parseDefines([bad])).toThrow(UsageError);
    }
    expect(() => parseDefines(["A=1", "A=2"])).toThrow(/A is given twice/);
  });

  it("takes a base58 public key for a Solana program, as the 32-byte word its address compares to", () => {
    // Mainnet USDC: the word `svm.sload(account, 0, 32).toBe()` reads from a USDC token account.
    const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const word = 0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61n;
    expect(parseDefines([`MINT=${usdc}`], "svm")).toEqual({ MINT: word });
    expect(parseDefinesFile(JSON.stringify({ MINT: usdc }), "d.json", "svm")).toEqual({
      MINT: word,
    });
    // Integer syntax wins: digits are the integer, even where they would also be base58.
    expect(parseDefines(["N=12345"], "svm")).toEqual({ N: 12345n });
    expect(() => parseDefines([`MINT=${usdc}`])).toThrow(/is a Solana public key \(base58\)/);
    expect(() => parseDefines(["MINT=NotAKey0OIl"], "svm")).toThrow(/a base58 public key/);
  });

  it("reads a defines file of names to addresses, integers and booleans", () => {
    expect(
      parseDefinesFile(
        JSON.stringify({ R: RECIPIENT, N: 5, BIG: "1_000_000n", ON: true }),
        "d.json",
      ),
    ).toEqual({ R: BigInt(RECIPIENT), N: 5n, BIG: 1_000_000n, ON: true });
    for (const bad of [
      "[]",
      "1",
      "{",
      '{"A": null}',
      '{"A": 1.5}',
      '{"A": -1}',
      '{"A": [1]}',
      '{"A": 9007199254740993}',
      '{"1A": 1}',
    ]) {
      expect(() => parseDefinesFile(bad, "d.json")).toThrow(/--defines d\.json/);
    }
  });

  it("hashes a salt label with potSalt, takes an exact salt as given, and defaults to zero", () => {
    expect(parseSalt("treasury", undefined)).toEqual({
      salt: potSalt("treasury"),
      flag: "--salt treasury",
    });
    expect(potSalt("treasury")).toBe(keccak256(stringToBytes("treasury")));
    expect(parseSalt("my pot", undefined).flag).toBe('--salt "my pot"');
    const exact = `0x${"ab".repeat(32)}`;
    expect(parseSalt(undefined, exact)).toEqual({ salt: exact, flag: `--salt-hex ${exact}` });
    expect(parseSalt(undefined, undefined)).toEqual({ salt: SAUCE_INTENT_POT_SALT });
    expect(() => parseSalt("a", exact)).toThrow(/give --salt or --salt-hex, not both/);
    expect(() => parseSalt("", undefined)).toThrow(/a label cannot be empty/);
    expect(() => parseSalt(undefined, "0x07")).toThrow(UsageError);
    expect(() => potSalt("")).toThrow(/cannot be empty/);
  });

  it("finds a chain by slug, alias or id, and lists the chains when it cannot", () => {
    expect(parseChain("base").id).toBe(8453);
    expect(parseChain("8453").slug).toBe("base");
    expect(parseChain("eth").slug).toBe("ethereum");
    expect(() => parseChain("basee")).toThrow(/--chain: Unknown chain 'basee' \(known slugs: /);
  });

  it("reads @chain and @target from the leading comment lines only", () => {
    expect(parseHeader("// @chain base\n// @target evm\n// prose\nx;", "f")).toEqual({
      chain: "base",
      target: "evm",
    });
    expect(parseHeader("x;\n// @chain base\n", "f")).toEqual({});
    expect(parseHeader("// prose @chain base\n", "f")).toEqual({});
    expect(() => parseHeader("// @chain base\n// @chain arbitrum\n", "f")).toThrow(
      /f:2: the header gives @chain twice/,
    );
  });
});

describe("sauce (no command)", () => {
  it("prints usage, and exits 2 when given nothing", async () => {
    const bare = await sauce();
    expect(bare.code).toBe(2);
    expect(bare.stderr).toMatch(/Usage: sauce <command>/);
    for (const argv of [["--help"], ["help"], ["help", "tx"], ["tx", "--help"], ["pot", "-h"]]) {
      const run = await sauce(...argv);
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/Usage: sauce/);
    }
    expect((await sauce("tx", "--help")).stdout).toMatch(/--rpc-url <url>/);
  });

  it("names an unknown command, and prints its own version", async () => {
    const run = await sauce("deploy");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /unknown command 'deploy'\. Commands: compile, actions, simulate, run, /,
    );
    expect((await sauce("--version")).stdout).toBe(`${MANIFEST.name} ${MANIFEST.version}\n`);
  });
});

describe("a program file that is a command: a leading #! line", () => {
  const SHEBANG = "#!/usr/bin/env -S npx -y @eco-incorp/sauce simulate";
  // USDC.transfer lowers to an import the SDK puts above the program, which a #! line has to
  // precede to be one: the line is blanked, so the import is free to go first.
  const PROGRAM =
    "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n";

  it("compiles to the same bytecode as the file without it, from a file or from stdin", async () => {
    const plain = await sauce("compile", file("plain.sauce.ts", PROGRAM), "--chain", "base");
    expect(plain.code).toBe(0);
    const run = await sauce(
      ...["compile", file("pay.sauce.ts", `${SHEBANG}\n${PROGRAM}`), "--chain", "base"],
    );
    expect([run.code, run.stderr]).toEqual([0, ""]);
    expect(run.stdout).toBe(plain.stdout);
    const piped = await sauceWith(
      { readStdin: () => `${SHEBANG}\n${PROGRAM}` },
      ...["compile", "-", "--chain", "base"],
    );
    expect(piped.stdout).toBe(plain.stdout);
  });

  it("keeps the file's own line numbers in a compile error", async () => {
    const run = await sauce(
      ...[
        "compile",
        file("broken.sauce.ts", `${SHEBANG}\n${PROGRAM.replace("amount);", "nope);")}`),
      ],
      ...["--chain", "base"],
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/broken\.sauce\.ts:3:/);
    expect(run.stderr).toContain("nope");
  });
});

describe("sauce compile", () => {
  it("compiles a file byte-for-byte as compileSauceProgram compiles it", async () => {
    const run = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "ethereum",
      ...PAY_DEFINES,
    );
    expect(run.code).toBe(0);
    const built = compileSauceProgram("ethereum", PAY, {
      defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT: 1000n },
    });
    expect(run.stdout).toBe(`${bytesToHex(built.bytecode)}\n`);
  });

  it("has the chain's ambient names a bare compileSauceRoute does not: chainId and @sauce/token", async () => {
    const body = "require(chainId == 8453n);\ntransfer(USDC, RECIPIENT, 5n);\n";
    const run = await sauce(
      "compile",
      file("ambient.sauce.ts", body),
      "--chain",
      "base",
      "--define",
      `RECIPIENT=${RECIPIENT}`,
    );
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/^0x[0-9a-f]+\n$/);
    expect(() =>
      compileSauceRoute(
        "base",
        body,
        { pot: OWNER, engine: OWNER },
        {
          defines: { RECIPIENT: BigInt(RECIPIENT) },
        },
      ),
    ).toThrow();
  });

  it("prints JSON with the size, the compiler and the engine the program pairs with", async () => {
    const out = json(
      await sauce(
        "compile",
        file("pay.sauce.ts", PAY),
        "--chain",
        "ethereum",
        ...PAY_DEFINES,
        "--json",
      ),
    );
    const compiler = JSON.parse(
      readFileSync(join(SDK, "node_modules/sauce-compiler/package.json"), "utf8"),
    );
    const release = v12DeployedAddresses().releases["v12-evm"];
    expect(out).toEqual({
      chain: "ethereum",
      chainId: 1,
      target: "evm",
      bytecode: expect.stringMatching(/^0x[0-9a-f]+$/),
      size: ((out.bytecode as string).length - 2) / 2,
      payload: { size: ((out.bytecode as string).length - 2) / 2, argumentsSize: 0 },
      entryEncoding: "abi-v1",
      entryParams: [],
      entrySchema: null,
      returnType: null,
      defines: [
        { name: "AMOUNT", value: "1000", source: "user", chain: "ethereum" },
        { name: "RECIPIENT", value: RECIPIENT, source: "user", chain: "ethereum" },
        {
          name: "USDC",
          value: getAddress(routes.TOKEN_REGISTRY[1]!.find((t) => t.symbol === "USDC")!.address),
          source: "chain",
          kind: "token",
          chain: "ethereum",
        },
        {
          name: "USDT",
          value: getAddress(routes.TOKEN_REGISTRY[1]!.find((t) => t.symbol === "USDT")!.address),
          source: "chain",
          kind: "token",
          chain: "ethereum",
        },
      ],
      contracts: [],
      compiler: { name: "@eco-incorp/sauce-compiler", version: compiler.version },
      engine: {
        release: "v12-evm",
        version: release.version,
        commit: release.commit,
        address: getAddress(v12EngineAddress()),
      },
    });
  });

  it("shows a define as an address only where it was written as one, whatever its size", async () => {
    // A price limit just under MAX_SQRT_RATIO is 160 bits wide, and still a number.
    const limit = "1461446703485210103287273052203988822378723970341";
    const program = file(
      "limit.sauce.ts",
      "const LIMIT = 0n;\nconst RECIPIENT = 0n;\nconst SMALL = 0n;\nfunction main() {\n" +
        "  require(LIMIT > SMALL && RECIPIENT != 0n);\n}\n",
    );
    const defines = file("values.json", JSON.stringify({ RECIPIENT, SMALL: "0x1234" }));
    const run = await sauce(
      ...["compile", program, "--chain", "base", "--json"],
      ...["--define", `LIMIT=${limit}`, "--defines", defines],
    );
    expect(run.code).toBe(0);
    expect((JSON.parse(run.stdout) as { defines: unknown[] }).defines).toEqual([
      { name: "LIMIT", value: limit, source: "user", chain: "base" },
      { name: "RECIPIENT", value: RECIPIENT, source: "user", chain: "base" },
      { name: "SMALL", value: "4660", source: "user", chain: "base" },
    ]);
  });

  it("refuses a past deadline in the commands themselves, which every front end calls", async () => {
    const { compileCommand, cookOf, refusePastDeadline } = await import("../src/cli/commands.js");
    const { publishCommand } = await import("../src/cli/publish.js");
    // As the MCP tools build it: a ProgramInput by hand, no CLI argument handling.
    const input = {
      file: "pay.sauce.ts",
      text: PAY,
      chain: requireChain("base"),
      defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT: 1000n },
      compactArgs: false,
      intents: { deadline: 1728432000n },
    };
    const past = /--intent-deadline 1728432000 \(2024-10-09T00:00:00\.000Z\) has passed/;
    await expect(compileCommand(input, nodeIo())).rejects.toThrow(past);
    expect(() =>
      cookOf(
        {
          ...input,
          target: { owner: getAddress(RECIPIENT), salt: `0x${"00".repeat(32)}` },
        } as never,
        nodeIo(),
      ),
    ).toThrow(past);
    await expect(publishCommand({ ...input, dryRun: false } as never, nodeIo())).rejects.toThrow(
      past,
    );
    // A deadline still ahead passes; one at the exact second does not.
    expect(() => refusePastDeadline({ intents: { deadline: 2000000000n } })).not.toThrow();
    expect(() => refusePastDeadline({ intents: { deadline: 1000n } }, 1_000_000)).toThrow(
      /has passed/,
    );
  });

  it("names a price limit at or past the bounds a pool takes, where it fills nothing", async () => {
    const program = file(
      "limits.sauce.ts",
      "const SQRT_PRICE_LIMIT_X96 = 0n;\nfunction main(sqrtPriceLimitX96: Uint256) {\n" +
        "  require(SQRT_PRICE_LIMIT_X96 != sqrtPriceLimitX96);\n}\n",
    );
    const max = "1461446703485210103287273052203988822378723970342";
    const run = await sauce(
      ...["compile", program, "--chain", "base", "--define", `SQRT_PRICE_LIMIT_X96=${max}`],
      ...["--args", "4295128739"],
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(
      `SQRT_PRICE_LIMIT_X96 = ${max} is MAX_SQRT_RATIO: a V3-style pool takes a price limit ` +
        "strictly between 4295128739 and",
    );
    expect(run.stderr).toContain("sqrtPriceLimitX96 = 4295128739 is MIN_SQRT_RATIO");
    // An intent's limit, named before it is published, whichever way its reward is paid.
    const intent = file(
      "limit-intent.sauce.ts",
      `// @chain ethereum\nBase.hop({ send: { token: USDC, amount: 7 }, refundee: ${CREATOR} }).then(() => {\n` +
        "  require(SQRT_PRICE_LIMIT_X96 > 0);\n  USDC.transfer(RECIPIENT, 5);\n});\n",
    );
    const published = await sauce(
      ...["intent", "publish", intent, "--define", `SQRT_PRICE_LIMIT_X96=${max}`],
      ...["--define", `RECIPIENT=${RECIPIENT}`, "--intent-deadline", "2000000000"],
      ...["--intent-execution-fee", "0", "--value", "0"],
      ...["--from", CREATOR, "--format", "json"],
    );
    expect(published.code).toBe(0);
    expect(published.stderr).toContain(`SQRT_PRICE_LIMIT_X96 = ${max} is MAX_SQRT_RATIO`);
    // 0 (no limit) and a limit inside the bounds pass quietly.
    const fine = await sauce(
      ...["compile", program, "--chain", "base", "--define", "SQRT_PRICE_LIMIT_X96=0"],
      ...["--args", "4295128740"],
    );
    expect(fine.stderr).toBe("");
  });

  it("refuses an intent deadline that has passed, which no solver could ever fill", async () => {
    const run = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "base",
      ...PAY_DEFINES,
      "--intent-deadline",
      "1728432000",
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      "--intent-deadline 1728432000 (2024-10-09T00:00:00.000Z) has passed: an intent can be " +
        "filled only until its deadline, so this one never could be. Give a later Unix time",
    );
  });

  it("compiles for Solana, reporting the account manifest", async () => {
    const program = file(
      "svm.sauce.ts",
      "const vault = svm.remainingAccount(0);\nrequire(vault.dataLen > 0);\n",
    );
    for (const selector of [
      ["--chain", "solana"],
      ["--target", "svm"],
    ]) {
      const out = json(await sauce("compile", program, ...selector, "--json"));
      expect(out.target).toBe("svm");
      expect(out.chain).toBe("solana");
      expect(out.manifest).toEqual({ accounts: [{ kind: "remaining", from: 0 }] });
      expect(out.engine).toMatchObject({ release: "v12-svm", programId: expect.any(String) });
    }
  });

  it("reads an intent's body on its destination", async () => {
    const { appliedDefines } = await import("../src/cli/report.js");
    const opened =
      "Arbitrum.hop({ send: [{ token: USDC, amount: 1 }], refundee: 0x3333333333333333333333333333333333333333 })";
    const body = ["USDC.transfer(RECIPIENT, 1);", "require(chainId == 42161 && WETH != 0);"];
    const user = { RECIPIENT: 0x6666666666666666666666666666666666666666n };
    // Where each part runs is the compile's to say.
    const { defines } = appliedDefines(
      [`${opened}.then(() => {`, ...body, "});", ""].join("\n"),
      requireChain("base"),
      user,
      new Set(["RECIPIENT"]),
    );
    expect(defines.map((d) => `${d.name}@${d.chain}`)).toEqual([
      "RECIPIENT@arbitrum",
      "USDC@arbitrum",
      "USDC@base",
      "WETH@arbitrum",
      "chainId@arbitrum",
    ]);
  });

  it("reads a body's handler on its destination", async () => {
    const { appliedDefines } = await import("../src/cli/report.js");
    const opened =
      "Arbitrum.hop({ send: [{ token: USDC, amount: 1 }], refundee: 0x3333333333333333333333333333333333333333 })";
    const user = { RECIPIENT: 0x6666666666666666666666666666666666666666n };
    const read = (text: string) =>
      appliedDefines(text, requireChain("base"), user, new Set(["RECIPIENT"])).defines.map(
        (d) => `${d.name}@${d.chain}`,
      );
    // A body's own handler runs on its destination alone.
    expect(
      read(
        `${opened}.then(() => { require(WETH != 0); }).catch((e) => { USDC.transfer(RECIPIENT, 1); });\n`,
      ),
    ).toEqual(["RECIPIENT@arbitrum", "USDC@arbitrum", "USDC@base", "WETH@arbitrum"]);
  });

  it("holds a define of a chain-scoped name on its own chain, and any other at every depth", async () => {
    // RECIPIENT is the user's alone, so the intent body reads it too. USDC is a name each chain
    // sets: the user's holds on Base, where the reward reads it, and the body on Arbitrum reads
    // Arbitrum's; WETH is read only there, so the user's WETH changes nothing.
    const recipient = "0x6666666666666666666666666666666666666666";
    const mine = "0x7777777777777777777777777777777777777777";
    const text = [
      "Arbitrum.hop({ send: [{ token: USDC, amount: 1n }], refundee: 0x3333333333333333333333333333333333333333 }).then(() => {",
      "  USDC.transfer(RECIPIENT, 1n);",
      "  require(chainId == 42161n && WETH != 0n);",
      "});",
      "",
    ].join("\n");
    const { appliedDefines } = await import("../src/cli/report.js");
    const base = routes.chainDefines(requireChain("base"));
    const arbitrum = routes.chainDefines(requireChain("arbitrum"));
    const address = (value: unknown) =>
      getAddress(`0x${(value as bigint).toString(16).padStart(40, "0")}`);
    const user = { RECIPIENT: BigInt(recipient), USDC: BigInt(mine), WETH: BigInt(mine) };
    const report = appliedDefines(
      text,
      requireChain("base"),
      user,
      new Set(["RECIPIENT", "USDC", "WETH"]),
    );
    expect(report.defines).toEqual([
      { name: "RECIPIENT", value: getAddress(recipient), source: "user", chain: "arbitrum" },
      {
        name: "USDC",
        value: address(arbitrum.USDC),
        source: "chain",
        kind: "token",
        chain: "arbitrum",
      },
      {
        name: "USDC",
        value: getAddress(mine),
        source: "user",
        replaces: address(base.USDC),
        chain: "base",
      },
      {
        name: "WETH",
        value: address(arbitrum.WETH),
        source: "chain",
        kind: "token",
        chain: "arbitrum",
      },
      { name: "chainId", value: "42161", source: "chain", kind: "chain id", chain: "arbitrum" },
    ]);
    expect(report.unread).toEqual([{ name: "WETH", readOn: ["arbitrum"] }]);
    // And the command says why the WETH define changes nothing.
    const run = await sauce(
      "compile",
      file("scoped.sauce.ts", text),
      "--chain",
      "base",
      "--define",
      `RECIPIENT=${recipient}`,
      "--define",
      `WETH=${mine}`,
      "--intent-deadline",
      "2000000000",
      "--intent-execution-fee",
      "0",
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(
      "reads WETH only in intents on arbitrum, where it is that chain's own",
    );
  });

  it("reports the defines it applied and where each came from, and the contracts it resolved", async () => {
    // A venue the chain sets (UniswapV3_Factory), one the user sets, one the user sets and never
    // reads, and a namespace call and a token — at the top and inside an intent body, which reads
    // its own chain's.
    const program = file(
      "venues.sauce.ts",
      [
        "const UniswapV3_Factory = 0n;",
        "const PANCAKE = 0n;",
        "function main(amount: Uint256) {",
        "  require(UniswapV3_Factory != 0n && PANCAKE != 0n && amount > 0n);",
        "  const pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);",
        "  require(pool != 0n);",
        "  Arbitrum.hop({ send: [{ token: USDC, amount: amount }], refundee: 0x3333333333333333333333333333333333333333 }).then(() => {",
        "    const there = UniswapV3.Factory.getPool(USDC, 2n, 3n);",
        "    require(there != 0n);",
        "  });",
        "}",
        "",
      ].join("\n"),
    );
    const pancake = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
    const run = await sauce(
      "compile",
      program,
      "--chain",
      "base",
      "--define",
      `PANCAKE=${pancake}`,
      "--define",
      "UNUSED=5",
      "--intent-deadline",
      "2000000000",
      "--intent-execution-fee",
      "0",
      "--json",
      "--args",
      "1000",
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("--define UNUSED: ");
    expect(run.stderr).toContain("never reads UNUSED, so the define changes nothing");
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    const base = routes.chainDefines(requireChain("base"));
    const address = (value: unknown) =>
      getAddress(`0x${(value as bigint).toString(16).padStart(40, "0")}`);
    const arbitrum = routes.chainDefines(requireChain("arbitrum"));
    expect(out.defines).toEqual([
      { name: "PANCAKE", value: pancake, source: "user", chain: "base" },
      {
        name: "USDC",
        value: address(arbitrum.USDC),
        source: "chain",
        kind: "token",
        chain: "arbitrum",
      },
      { name: "USDC", value: address(base.USDC), source: "chain", kind: "token", chain: "base" },
      {
        name: "UniswapV3_Factory",
        value: address(base.UniswapV3_Factory),
        source: "chain",
        kind: "contract",
        chain: "base",
      },
      { name: "WETH", value: address(base.WETH), source: "chain", kind: "token", chain: "base" },
    ]);
    expect(out.contracts).toEqual([
      {
        reference: "UniswapV3.Factory",
        contract: "UniswapV3.Factory",
        chain: "arbitrum",
        address: address(arbitrum.UniswapV3_Factory),
      },
      {
        reference: "UniswapV3.Factory",
        contract: "UniswapV3.Factory",
        chain: "base",
        address: address(base.UniswapV3_Factory),
      },
    ]);
    // main(amount): one ABI-v1 word after the program.
    expect(out.payload).toEqual({ size: (out.size as number) + 32, argumentsSize: 32 });
    // Without its arguments the payload is not known.
    const bare = JSON.parse(
      (
        await sauce(
          "compile",
          program,
          "--chain",
          "base",
          "--define",
          `PANCAKE=${pancake}`,
          "--intent-deadline",
          "2000000000",
          "--intent-execution-fee",
          "0",
          "--json",
        )
      ).stdout,
    ) as Record<string, unknown>;
    expect(bare.payload).toBeNull();
  });

  it("says whether a Solana cook fits one transaction, for its accounts", async () => {
    const program = file(
      "pay.sauce.ts",
      [
        "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, pot: Account<Signer>, amount: Uint256) {",
        "  transfer(1n, tokenProgram, source, dest, pot, amount);",
        "}",
        "",
      ].join("\n"),
    );
    const sized = async (...extra: string[]) =>
      JSON.parse(
        (await sauce("compile", program, "--chain", "solana", "--json", ...extra)).stdout,
      ) as { cook?: { size: number; limit: number; fits: boolean; assumed: string[] } };
    expect((await sized()).cook).toBeUndefined();
    const distinct = (await sized("--args", "5")).cook!;
    expect(distinct).toMatchObject({ limit: 1232, fits: true });
    expect(distinct.assumed).toEqual(["tokenProgram", "source", "dest", "pot"]);
    // The Pot named as itself is the cook's own account, which the Kitchen signs for: the
    // transaction carries one key and one signature fewer than for a signer of its own.
    const pot = (await sized("--account", "pot=pot", "--args", "5")).cook!;
    expect(pot.assumed).toEqual(["tokenProgram", "source", "dest"]);
    expect(pot.size).toBeLessThan(distinct.size);
    // Past the limit: said on stderr, and that `run` stages it.
    const large = file(
      "large.sauce.ts",
      `function main(x: Uint256) {\n${Array.from({ length: 60 }, (_, i) => `  require(x != ${i}n, "${"x".repeat(20)}${i}");`).join("\n")}\n}\n`,
    );
    const run = await sauce("compile", large, "--chain", "solana", "--json", "--args", "99");
    expect(JSON.parse(run.stdout).cook).toMatchObject({ fits: false });
    expect(run.stderr).toMatch(/past Solana's 1232: `sauce run` stages the program/);
  });

  it("takes a Solana program's key defines in base58, as --account takes them", async () => {
    const program = file(
      "mint.sauce.ts",
      "const MINT = 0n;\nfunction main(mint: Account) {\n  require(mint.address == MINT);\n}\n",
    );
    const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const base58 = json(
      await sauce("compile", program, "--chain", "solana", "--define", `MINT=${usdc}`, "--json"),
    );
    const hex = json(
      await sauce(
        "compile",
        program,
        "--chain",
        "solana",
        "--define",
        "MINT=0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61",
        "--json",
      ),
    );
    expect(base58.bytecode).toBe(hex.bytecode);
    expect(base58.bytecode).toContain("c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca6");
    const evm = await sauce("compile", program, "--chain", "base", "--define", `MINT=${usdc}`);
    expect(evm.code).toBe(2);
    expect(evm.stderr).toMatch(/is a Solana public key \(base58\)/);
  });

  it("takes the chain and target from the file's header, and a flag over it", async () => {
    const program = file("header.sauce.ts", `// @chain ethereum\n// @target evm\n${PAY}`);
    const fromHeader = await sauce("compile", program, ...PAY_DEFINES, "--json");
    expect(json(fromHeader).chain).toBe("ethereum");
    const mismatched = await sauce("compile", program, "--chain", "solana");
    expect(mismatched.code).toBe(2);
    expect(mismatched.stderr).toMatch(/header\.sauce\.ts's \/\/ @target evm does not match solana/);
    const overridden = await sauce(
      "compile",
      file("h2.sauce.ts", "// @chain base\nrequire(chainId == 1n);\n"),
      "--chain",
      "1",
    );
    expect(overridden.code).toBe(0);
    const bad = await sauce("compile", file("h3.sauce.ts", "// @chain basee\nx;\n"));
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/h3\.sauce\.ts's \/\/ @chain: Unknown chain 'basee'/);
  });

  it("layers --define over a --defines file", async () => {
    const defines = file("defines.json", JSON.stringify({ RECIPIENT, AMOUNT: 7 }));
    const layered = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "ethereum",
      "--defines",
      defines,
      "--define",
      "AMOUNT=1000",
    );
    const direct = await sauce(
      "compile",
      file("pay2.sauce.ts", PAY),
      "--chain",
      "ethereum",
      ...PAY_DEFINES,
    );
    expect(layered.stdout).toBe(direct.stdout);
  });

  it("writes to --out instead of stdout", async () => {
    const out = join(work, "out.hex");
    const run = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "ethereum",
      ...PAY_DEFINES,
      "--out",
      out,
    );
    expect(run.stdout).toBe("");
    expect(readFileSync(out, "utf8")).toMatch(/^0x[0-9a-f]+\n$/);
  });

  it("serves the program's relative imports from beside the file", async () => {
    file("lib/fee.js", "export function fee(amount) { return amount / 100n; }\n");
    const program = file(
      "main.sauce.ts",
      'import { fee } from "./lib/fee.js";\nfunction main() {\n  require(fee(AMOUNT) > 0n);\n}\n',
    );
    const run = await sauce("compile", program, "--chain", "base", "--define", "AMOUNT=1000");
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const missing = file(
      "lost.sauce.ts",
      'import { fee } from "./lib/nope.js";\nfunction main() {}\n',
    );
    expect((await sauce("compile", missing, "--chain", "base")).code).toBe(1);
    // A script imports too: its imports lead it, and its statements are the entry.
    const script = file(
      "script.sauce.ts",
      'import { fee } from "./lib/fee.js";\nrequire(fee(1000n) > 0n);\n',
    );
    const scripted = await sauce("compile", script, "--chain", "base");
    expect(scripted.stderr).toBe("");
    expect(scripted.code).toBe(0);
  });

  it("reports a compile error at the file's own line, even on a line the SDK rewrote", async () => {
    const program = file("pay.sauce.ts", `// Pays.\n${PAY}`);
    const run = await sauce("compile", program, "--chain", "ethereum", "--define", "AMOUNT=1");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`--> ${program}:2:15`);
    expect(run.stderr).toContain("2 | USDC.transfer(RECIPIENT, AMOUNT);");
    expect(run.stderr).toMatch(/\|\s{15}\^{9}/);
    expect(run.stderr).toContain(
      "hint: if RECIPIENT is a value you supply, make it a parameter of main (`RECIPIENT: Uint256`, or `Address`) and pass it with --args",
    );
    expect(run.stderr).not.toContain("main.js");
  });

  it("reports a syntax error at the file's own line and column", async () => {
    const program = file("bad.sauce.ts", "USDC.transfer(RECIPIENT, 1n);\nconst z = ;\n");
    const run = await sauce("compile", program, "--chain", "base");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("error: Unexpected token");
    expect(run.stderr).toContain(`--> ${program}:2:11`);
    expect(run.stderr).toContain("2 | const z = ;");
  });

  it("names a token the chain does not register", async () => {
    const run = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "base",
      ...PAY_DEFINES,
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(
      /hint: USDT is not a registered token on base \(it has USDC, WETH, 67 stock tokens\)/,
    );
  });

  it("names a stock token's symbol in its issuer's case", async () => {
    const program = file(
      "stock.sauce.ts",
      "function main() {\n  require(SPCXC.balanceOf(ctx.self()) >= 0n);\n}\n",
    );
    const run = await sauce("compile", program, "--chain", "base");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      "hint: SPCXC is SPCXc on base: a token's symbol is case-sensitive",
    );
    const fixed = file(
      "stock-fixed.sauce.ts",
      "function main() {\n  require(SPCXc.balanceOf(ctx.self()) >= 0n);\n}\n",
    );
    expect((await sauce("compile", fixed, "--chain", "base")).code).toBe(0);
  });

  it("names a Solana stock mint's symbol in its issuer's case, and an EVM chain's token as one", async () => {
    const program = (symbol: string) =>
      file(
        `stock-${symbol}.sauce.ts`,
        `function main(account: Account): Uint256 {\n  return balanceOf(${symbol}, account);\n}\n`,
      );
    const cased = await sauce("compile", program("tslax"), "--chain", "solana");
    expect(cased.code).toBe(1);
    expect(cased.stderr).toContain(
      "hint: tslax is TSLAx on solana: a token's symbol is case-sensitive",
    );
    const evm = await sauce("compile", program("SPCXc"), "--chain", "solana");
    expect(evm.code).toBe(1);
    expect(evm.stderr).toContain(
      "hint: SPCXc is a token on base, not solana: sauce globals --chain solana --search <text> " +
        "finds the mints it has",
    );
    expect((await sauce("compile", program("TSLAx"), "--chain", "solana")).code).toBe(0);
  });

  it("needs no fee for --intent-execution-fee auto where no intent is opened", async () => {
    const run = await sauce(
      ...["compile", file("pay.sauce.ts", "USDC.transfer(RECIPIENT, AMOUNT);\n")],
      ...["--chain", "arbitrum", ...PAY_DEFINES, "--intent-execution-fee", "auto", "--json"],
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("no intent here runs a program, so none pays a fee");
    expect(JSON.parse(run.stdout).intentPots).toBeUndefined();
    // Every body is a program its destination's Kitchen charges for, a token-only one too: with
    // nothing to read the fee from, it is asked for.
    const bridge = file(
      "bridge.sauce.ts",
      `Base.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${CREATOR} }).then(() => {\n  USDC.transfer(RECIPIENT, 5);\n});\n`,
    );
    const unpriced = await sauce(
      ...["compile", bridge, "--chain", "arbitrum", "--define", `RECIPIENT=${RECIPIENT}`],
      ...["--intent-deadline", "2000000000", "--offline"],
    );
    expect(unpriced.code).toBe(2);
    expect(unpriced.stderr).toContain(
      "an intent's body runs a program on base, whose cook pays its Kitchen's fee",
    );
  });

  it("builds an intent the program opens, naming the refundee it lacks", async () => {
    const body = (refundee: string) =>
      [
        "const amount = USDC.balanceOf(ctx.self());",
        `Arbitrum.hop({ send: [{ token: USDC, amount }]${refundee} }).then(() => {`,
        "  USDC.transfer(RECIPIENT, amount);",
        "});",
        "",
      ].join("\n");
    const recipient = ["--define", `RECIPIENT=${RECIPIENT}`];
    // A Pot runs it, and no wallet publishes it: it names its creator.
    const unnamed = await sauce(
      ...["compile", file("unnamed.sauce.ts", body("")), "--chain", "base", ...recipient],
    );
    expect(unnamed.code).toBe(1);
    expect(unnamed.stderr).toMatch(
      /a hop needs a `refundee`[^]*hint: write `refundee: <address>` in the hop's config/,
    );
    const named = body(`, refundee: ${CREATOR}`);
    const salt = `0x${"00".repeat(32)}` as const;
    const built = await sauce(
      ...["compile", file("intent.sauce.ts", named), "--chain", "base", ...recipient],
      ...["--intent-deadline", "2000000000", "--intent-salt", salt],
      ...["--intent-execution-fee", "0"],
    );
    expect(built.code).toBe(0);
    const program = compileSauceProgram("base", named, {
      defines: { RECIPIENT: BigInt(RECIPIENT) },
      intents: { deadline: 2_000_000_000n, salt, executionFee: 0n },
    });
    expect(built.stdout).toBe(`${bytesToHex(program.bytecode)}\n`);
  });

  it("names what is wrong with the invocation, exiting 2", async () => {
    const program = file("pay.sauce.ts", PAY);
    const cases: Array<[string[], RegExp]> = [
      [["compile", program], /missing --chain <slug\|id>/],
      [["compile", "--chain", "base"], /missing <file>/],
      [["compile", program, "extra", "--chain", "base"], /unexpected argument extra/],
      [["compile", program, "--chain"], /--chain needs a value: <slug\|id>/],
      [["compile", program, "--chain", "base", "--bogus"], /unknown option --bogus/],
      [["compile", program, "--chain", "base", "--json=1"], /--json takes no value/],
      [
        ["compile", program, "--chain", "base", "--target", "wasm"],
        /--target: 'wasm' is not a target/,
      ],
      [["compile", program, "--target", "evm"], /missing --chain/],
      [["compile", program, "--chain", "base", "--define", "A"], /--define: 'A' is not NAME=VALUE/],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce(...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
      expect(run.stderr).toMatch(/Run `sauce compile --help` for usage\./);
    }
    const missing = await sauce("compile", join(work, "nope.sauce.ts"), "--chain", "base");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/nope\.sauce\.ts: no such file/);
  });
});

describe("sauce tx", () => {
  const pay = (): string => file("pay.sauce.ts", PAY);

  it("prints the unsigned cook on the owner's derived Pot as JSON, and what must hold on stderr", async () => {
    const run = await sauce(
      "tx",
      pay(),
      "--chain",
      "ethereum",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--value",
      "1234",
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    const pot = v12PredictPot(OWNER, SAUCE_INTENT_POT_SALT);
    const program = (
      await sauce("compile", pay(), "--chain", "ethereum", ...PAY_DEFINES)
    ).stdout.trim();
    const cook = decodeFunctionData({ abi: v12Pot.abi, data: out.data as Hex });
    expect(cook.functionName).toBe("cook");
    expect(cook.args).toEqual([getAddress(v12EngineAddress()), program]);
    expect(out).toEqual({
      chainId: 1,
      to: pot,
      data: v12Pot.encodeCook(getAddress(v12EngineAddress()), program as Hex),
      value: "1234",
    });
    expect(run.stderr).toContain(`Pot ${pot} belongs to ${OWNER} (salt ${SAUCE_INTENT_POT_SALT}).`);
    expect(run.stderr).toContain(
      `It must be deployed (sauce pot --deploy --owner ${OWNER} --chain ethereum --keystore <keystore>)`,
    );
    expect(run.stderr).toContain(`Send from ${OWNER}: cook() is onlyOwner.`);
  });

  it("prints a cast send line only when asked to, with the endpoint and key left open", async () => {
    const asJson = JSON.parse(
      (await sauce("tx", pay(), "--chain", "1", "--owner", OWNER, ...PAY_DEFINES, "--value", "5"))
        .stdout,
    ) as { to: `0x${string}`; data: Hex };
    const run = await sauce(
      "tx",
      pay(),
      "--chain",
      "1",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--value",
      "5",
      "--format",
      "cast",
    );
    expect(run.stdout).toBe(
      `cast send ${asJson.to} ${asJson.data} --value 5 --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>\n`,
    );
    expect(castSend(asJson.to, asJson.data, 5n)).toBe(run.stdout.trim());
    const bad = await sauce(
      "tx",
      pay(),
      "--chain",
      "1",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--value",
      "5",
      "--format",
      "yaml",
    );
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--format: 'yaml' is not json or cast/);
  });

  it("derives a labelled Pot with potSalt, and an exact salt as given", async () => {
    const pots = async (...salt: string[]) =>
      (
        JSON.parse(
          (
            await sauce(
              "tx",
              pay(),
              "--chain",
              "1",
              "--owner",
              OWNER,
              ...PAY_DEFINES,
              "--value",
              "0",
              ...salt,
            )
          ).stdout,
        ) as { to: string }
      ).to;
    expect(await pots("--salt", "treasury")).toBe(v12PredictPot(OWNER, potSalt("treasury")));
    const exact: Hex = `0x${"00".repeat(31)}07`;
    expect(await pots("--salt-hex", exact)).toBe(v12PredictPot(OWNER, exact));
    expect(await pots()).toBe(v12PredictPot(OWNER, SAUCE_INTENT_POT_SALT));
    const hinted = await sauce(
      "tx",
      pay(),
      "--chain",
      "1",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--value",
      "0",
      "--salt",
      "treasury",
    );
    expect(hinted.stderr).toContain(
      `sauce pot --deploy --owner ${OWNER} --chain ethereum --salt treasury --keystore <keystore>`,
    );
  });

  describe("main's arguments", () => {
    const SPLIT =
      "function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {\n" +
      "  for (let i = 0; i < recipients.length; i = i + 1) {\n" +
      "    transfer(token, recipients[i], amount);\n" +
      "    if (alsoUsdc) {\n" +
      "      USDC.transfer(recipients[i], amount);\n" +
      "    }\n" +
      "  }\n" +
      "}\n";
    const POT = "0x1111111111111111111111111111111111111111";
    const ARGS = [OWNER, `["${RECIPIENT}","${CREATOR}"]`, "1000", "true"];
    const tx = (...extra: string[]) =>
      sauce(
        "tx",
        file("split.sauce.ts", SPLIT),
        "--chain",
        "base",
        "--pot",
        POT,
        "--value",
        "0",
        ...extra,
      );
    const dataOf = (run: Run): Hex => {
      expect(run.code).toBe(0);

      return (JSON.parse(run.stdout) as { data: Hex }).data;
    };

    it("reports main's parameters and their encoding", async () => {
      const out = json(
        await sauce("compile", file("split.sauce.ts", SPLIT), "--chain", "base", "--json"),
      );
      expect(out.entryEncoding).toBe("abi-v1");
      expect(out.entryParams).toEqual([
        { name: "token", type: "Address" },
        { name: "recipients", type: "Address[]" },
        { name: "amount", type: "Uint256" },
        { name: "alsoUsdc", type: "bool" },
      ]);
      const compact = json(
        await sauce(
          "compile",
          file("split.sauce.ts", SPLIT),
          "--chain",
          "base",
          "--compact-args",
          "--json",
        ),
      );
      expect(compact.entryEncoding).toBe("compact-v1");
      expect(compact.entrySchema).toMatch(/^0x94/);
    });

    it("appends the encoded values to the program the cook runs", async () => {
      const data = dataOf(await tx("--args", ...ARGS));
      const program = (
        await sauce("compile", file("split.sauce.ts", SPLIT), "--chain", "base")
      ).stdout.trim();
      const encoded = encodeAbiParameters(
        [{ type: "address" }, { type: "address[]" }, { type: "uint256" }, { type: "bool" }],
        [OWNER, [RECIPIENT, CREATOR], 1000n, true],
      );
      const cook = decodeFunctionData({ abi: v12Pot.abi, data });
      expect(cook.args).toEqual([getAddress(v12EngineAddress()), `${program}${encoded.slice(2)}`]);
      expect(
        dataOf(await tx("--args-json", JSON.stringify([OWNER, [RECIPIENT, CREATOR], 1000, true]))),
      ).toBe(data);
      const argsFile = file(
        "args.json",
        JSON.stringify([OWNER, [RECIPIENT, CREATOR], "1000", true]),
      );
      expect(dataOf(await tx("--args-json", argsFile))).toBe(data);
    });

    it("encodes compact-v1 for a program compiled for it", async () => {
      const data = dataOf(await tx("--compact-args", "--args", ...ARGS));
      const program = compileSauceProgram("base", SPLIT, { compactArgs: true });
      const cook = decodeFunctionData({ abi: v12Pot.abi, data });
      const args = encodeCompactArguments(program.entrySchema!, [
        OWNER,
        [RECIPIENT, CREATOR],
        1000n,
        true,
      ]);
      expect(cook.args[1]).toBe(`${bytesToHex(program.bytecode)}${bytesToHex(args).slice(2)}`);
    });

    it("names what is wrong with them, exiting 2", async () => {
      const cases: Array<[string[], RegExp]> = [
        [
          [],
          /main\(token: Address, recipients: Address\[\], amount: Uint256, alsoUsdc: bool\) takes 4 arguments: pass them after --args/,
        ],
        [["--args", OWNER], /--args: main takes 4 arguments \(.*\), got 1/],
        [
          ["--args", "0x12", "[]", "1", "true"],
          /argument 1 \(token: Address\): '0x12' is not an address/,
        ],
        [
          ["--args", OWNER, RECIPIENT, "1", "true"],
          /argument 2 \(recipients: Address\[\]\) takes JSON, such as \[1, 2\]/,
        ],
        [
          ["--args", OWNER, "[]", "1.5", "true"],
          /argument 3 \(amount: Uint256\): '1.5' is not an unsigned integer/,
        ],
        [
          ["--args", OWNER, "[]", "1", "maybe"],
          /argument 4 \(alsoUsdc: bool\): 'maybe' is not a bool/,
        ],
        [["--args-json", "{}"], /--args-json: expected a JSON array/],
        [["--args-json", "[1]", "--args", "1"], /give --args or --args-json, not both/],
      ];
      for (const [extra, message] of cases) {
        const run = await tx(...extra);
        expect(run.stderr).toMatch(message);
        expect(run.code).toBe(2);
      }
      const missing = await tx("--args-json", join(work, "nope.json"));
      expect(missing.code).toBe(1);
      expect(missing.stderr).toMatch(/nope\.json: no such file/);
      const none = await sauce(
        "tx",
        pay(),
        "--chain",
        "ethereum",
        "--pot",
        POT,
        ...PAY_DEFINES,
        "--value",
        "0",
        "--args",
        "1",
      );
      expect(none.code).toBe(2);
      expect(none.stderr).toMatch(/main takes 0 arguments \(\), got 1/);
    });
  });

  it("cooks on a Pot named outright", async () => {
    const pot = "0x1111111111111111111111111111111111111111";
    const run = await sauce(
      "tx",
      pay(),
      "--chain",
      "1",
      "--pot",
      pot,
      ...PAY_DEFINES,
      "--value",
      "0",
    );
    expect(JSON.parse(run.stdout)).toMatchObject({ to: pot, value: "0" });
    expect(run.stderr).toContain("Send from the Pot's owner: cook() is onlyOwner.");
  });

  it("names what is wrong with the invocation, exiting 2", async () => {
    const program = pay();
    const cases: Array<[string[], RegExp]> = [
      [
        ["tx", program, "--chain", "ethereum", "--value", "0"],
        /missing --pot <address> or --owner <address>/,
      ],
      [
        ["tx", program, "--chain", "ethereum", "--pot", OWNER, "--owner", OWNER, "--value", "0"],
        /give --pot or --owner, not both/,
      ],
      [
        ["tx", program, "--chain", "ethereum", "--pot", OWNER, "--salt", "x", "--value", "0"],
        /--salt and --salt-hex go with --owner/,
      ],
      [
        [
          "tx",
          program,
          "--chain",
          "ethereum",
          "--owner",
          OWNER,
          "--salt",
          "a",
          "--salt-hex",
          `0x${"00".repeat(32)}`,
          "--value",
          "0",
        ],
        /give --salt or --salt-hex, not both: --salt <label> is hashed/,
      ],
      [
        [
          "tx",
          program,
          "--chain",
          "ethereum",
          "--owner",
          OWNER,
          "--salt-hex",
          "0x07",
          "--value",
          "0",
        ],
        /--salt-hex: '0x07' is not exactly 32 bytes/,
      ],
      [
        ["tx", program, "--chain", "ethereum", "--owner", OWNER],
        /missing --value <wei>[^]*--rpc-url or --config/,
      ],
      [
        ["tx", program, "--chain", "ethereum", "--owner", "0x12", "--value", "0"],
        /--owner: '0x12' is not an address/,
      ],
      [
        ["tx", program, "--chain", "ethereum", "--owner", OWNER, "--value", "1e18"],
        /--value: '1e18' is not an amount in wei/,
      ],
      [
        ["tx", program, "--chain", "solana", "--owner", OWNER, "--value", "0"],
        /--value is for EVM: on Solana the Kitchen's fee is read from the cluster/,
      ],
      [
        [
          "tx",
          program,
          "--chain",
          "ethereum",
          "--owner",
          OWNER,
          "--rpc-url",
          "http://127.0.0.1:1",
          "--config",
          "x.json",
        ],
        /give --rpc-url or --config, not both/,
      ],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce(...argv);
      expect(run.stderr).toMatch(message);
      expect(run.code).toBe(2);
    }
  });

  it("takes its endpoint from a --config file, and refuses a placeholder", async () => {
    const config = file("sauce.config.json", JSON.stringify({ rpcUrls: { "1": "<RPC_URL>" } }));
    const run = await sauce(
      "tx",
      pay(),
      "--chain",
      "1",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--config",
      config,
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/rpcUrls\["1"\] is not a URL; replace the placeholder/);
    // A chain the file has no entry for is read through the built-in endpoints (none here), not
    // refused: with --value, the cook is built without reading it.
    const other = await sauce(
      "tx",
      file("usdc.sauce.ts", "USDC.transfer(RECIPIENT, AMOUNT);\n"),
      "--chain",
      "base",
      "--owner",
      OWNER,
      ...PAY_DEFINES,
      "--config",
      config,
      "--value",
      "0",
    );
    expect(other.code).toBe(0);
    expect(JSON.parse(other.stdout).chainId).toBe(8453);
  });
});

describe("sauce intent publish, offline", () => {
  const INTENT = [
    "// @chain ethereum",
    `Base.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${CREATOR} })`,
    "  .then(() => {",
    "    USDC.transfer(RECIPIENT, 5);",
    "  });",
    "",
  ].join("\n");
  const FLAGS = [
    "--define",
    `RECIPIENT=${RECIPIENT}`,
    "--intent-deadline",
    "2000000000",
    "--intent-execution-fee",
    "0",
    // One salt for every run: the command picks a random one otherwise.
    "--intent-salt",
    `0x${"00".repeat(32)}`,
  ];
  /** Printed offline, so the cook's value is given: no Kitchen to read it from. */
  const PRINTED = ["--offline", "--value", "0"];

  it("prints the cook on the owner's Pot that publishes it, as `sauce tx` prints it", async () => {
    const bridge = file("bridge.sauce.ts", INTENT);
    const run = await sauce(
      ...["intent", "publish", bridge, ...FLAGS, ...PRINTED, "--from", OWNER, "--format", "json"],
    );
    expect(run.code).toBe(0);
    const tx = await sauce("tx", bridge, ...FLAGS, ...PRINTED, "--owner", OWNER);
    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(tx.stdout));
    expect(JSON.parse(run.stdout)).toMatchObject({
      chainId: 1,
      to: v12PredictPot(OWNER, SAUCE_INTENT_POT_SALT),
      value: "0",
    });
    // Another of the owner's Pots, by its salt.
    const salted = await sauce(
      ...["intent", "publish", bridge, ...FLAGS, ...PRINTED, "--from", OWNER, "--format", "json"],
      ...["--salt", "treasury"],
    );
    expect(JSON.parse(salted.stdout).to).toBe(v12PredictPot(OWNER, potSalt("treasury")));
    const cast = await sauce(
      ...["intent", "publish", bridge, ...FLAGS, ...PRINTED, "--from", OWNER, "--format", "cast"],
    );
    expect(cast.stdout.trim().split("\n")).toHaveLength(1);
    expect(cast.stdout).toMatch(
      /^cast send 0x[0-9a-fA-F]{40} 0x[0-9a-f]+ --value 0 --rpc-url <RPC_URL>/,
    );
    // A value the program measures as it runs is the cook's to measure: it prints all the same.
    const measured = await sauce(
      ...[
        "intent",
        "publish",
        file(
          "measured.sauce.ts",
          INTENT.replace("amount: 7", "amount: USDC.balanceOf(ctx.self())"),
        ),
      ],
      ...FLAGS,
      ...PRINTED,
      ...["--from", OWNER, "--format", "json"],
    );
    expect(measured.code).toBe(0);
  });

  it("refuses a file with no intent, or with main's arguments not given, before any network", async () => {
    const none = await sauce(
      ...["intent", "publish", file("none.sauce.ts", "require(chainId == 1);\n")],
      ...["--chain", "1", ...PRINTED, "--from", OWNER, "--format", "json"],
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/opens no intent — there is nothing to publish/);
    const typed = await sauce(
      "intent",
      "publish",
      file(
        "typed.sauce.ts",
        `function main(recipient: Address) {\n  Base.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${CREATOR} }).then(() => {\n    USDC.transfer(recipient, 5);\n  });\n}\n`,
      ),
      "--chain",
      "ethereum",
      ...FLAGS.slice(2),
      ...PRINTED,
      ...["--from", OWNER, "--format", "json"],
    );
    expect(typed.code).toBe(2);
    expect(typed.stderr).toMatch(/main\(recipient: Address\)/);
    // --fund pulls with what it signs or sends first; a printed cook carries neither.
    const funded = await sauce(
      ...["intent", "publish", file("bridge.sauce.ts", INTENT), ...FLAGS, ...PRINTED],
      ...["--from", OWNER, "--format", "json", "--fund", "USDC:1"],
    );
    expect(funded.code).toBe(2);
    expect(funded.stderr).toMatch(/--fund pulls the reward into the Pot with what it signs/);
  });

  it("needs a signer to send, and an endpoint to send through", async () => {
    const unsigned = await sauce("intent", "publish", file("bridge.sauce.ts", INTENT), ...FLAGS);
    expect(unsigned.code).toBe(2);
    expect(unsigned.stderr).toMatch(/missing a signer to publish from: --wallet <name>/);
    const offline = await sauce(
      ...["intent", "publish", file("bridge.sauce.ts", INTENT), ...FLAGS, "--offline"],
      ...["--private-key", OWNER_KEY],
    );
    expect(offline.code).toBe(2);
    expect(offline.stderr).toMatch(/--offline reads no chain, and this reads ethereum/);
  });
});

describe("sauce intent fill, offline", () => {
  const INTENT = [
    "// @chain arbitrum",
    `Base.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${CREATOR} }).then(() => {`,
    "  USDC.transfer(RECIPIENT, 5);",
    "});",
    "",
  ].join("\n");
  const FLAGS = [
    "--define",
    `RECIPIENT=${RECIPIENT}`,
    "--intent-deadline",
    "2000000000",
    "--intent-execution-fee",
    "0",
  ];
  /** An endpoint nothing listens on: every refusal below comes before any request. */
  const NOWHERE = ["--rpc-url", "http://127.0.0.1:9/"];

  it("needs the destination's endpoint, where no built-in one reaches it", async () => {
    const run = await sauce("intent", "fill", file("bridge.sauce.ts", INTENT), ...FLAGS);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/missing --rpc-url <url> \(or --config <file>\): the base endpoint/);
  });

  it("refuses a claimant that is neither 20 nor 32 bytes", async () => {
    const run = await sauce(
      "intent",
      "fill",
      file("bridge.sauce.ts", INTENT),
      ...FLAGS,
      ...NOWHERE,
      "--claimant",
      "0x1234",
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/--claimant: '0x1234' is neither an address/);
  });

  it("refuses a file with no intent, and one whose intents --rpc-url cannot all reach", async () => {
    const none = await sauce(
      "intent",
      "fill",
      file("none.sauce.ts", "require(chainId == 42161n);\n"),
      "--chain",
      "arbitrum",
      ...NOWHERE,
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/opens no intent: there is nothing for a solver to fill/);
    const two = await sauce(
      "intent",
      "fill",
      file(
        "two.sauce.ts",
        `${INTENT}Optimism.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${CREATOR} }).then(() => {\n  USDC.transfer(RECIPIENT, 5);\n});\n`,
      ),
      ...FLAGS,
      ...NOWHERE,
    );
    expect(two.code).toBe(2);
    expect(two.stderr).toMatch(/intents go to base and optimism: --rpc-url names one endpoint/);
  });

  it("refuses a source chain with no Portal to publish through", async () => {
    const run = await sauce(
      "intent",
      "fill",
      file("svm.sauce.ts", "function main() {}\n"),
      "--chain",
      "solana",
      ...NOWHERE,
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/rehearses intents an EVM chain opens, and solana is not one/);
  });
});

describe("defines a script cannot see", () => {
  it("refuses a define that a script's own top-level const would silently shadow", async () => {
    const script = file("script.sauce.ts", "const AMOUNT = 5n;\nrequire(AMOUNT > 0n);\n");
    const run = await sauce("compile", script, "--chain", "base", "--define", "AMOUNT=7");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /--define AMOUNT would not reach .*script\.sauce\.ts: with no `function main`, its top-level `const AMOUNT` is the script's own/,
    );
    // Read as a define, or declared beside a main, it reaches the program.
    expect(
      (
        await sauce(
          "compile",
          file("read.sauce.ts", "require(AMOUNT > 0n);\n"),
          "--chain",
          "base",
          "--define",
          "AMOUNT=7",
        )
      ).code,
    ).toBe(0);
    expect(
      (
        await sauce(
          "compile",
          file(
            "module.sauce.ts",
            "const AMOUNT = 5n;\nfunction main() {\n  require(AMOUNT > 0n);\n}\n",
          ),
          "--chain",
          "base",
          "--define",
          "AMOUNT=7",
        )
      ).code,
    ).toBe(0);
  });
});

describe("sauce pot", () => {
  it("predicts the Pot and prints Kitchen.deployPot unsigned", async () => {
    const run = await sauce("pot", "--owner", OWNER, "--chain", "base", "--salt", "treasury");
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    const salt = potSalt("treasury");
    expect(out).toEqual({
      chainId: 8453,
      pot: v12PredictPot(OWNER, salt),
      owner: OWNER,
      salt,
      kitchen: v12KitchenAddress(),
      to: v12KitchenAddress(),
      data: v12Kitchen.encodeDeployPot(OWNER, salt),
      value: "0",
    });
    expect(run.stderr).toMatch(/Any account may send it/);
    const cast = await sauce("pot", "--owner", OWNER, "--chain", "base", "--format", "cast");
    expect(cast.stdout).toMatch(
      new RegExp(
        `^cast send ${v12KitchenAddress()} 0x[0-9a-f]+ --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>\n$`,
      ),
    );
    const byDefault = JSON.parse(
      (await sauce("pot", "--owner", OWNER, "--chain", "base")).stdout,
    ) as { salt: string };
    expect(byDefault.salt).toBe(SAUCE_INTENT_POT_SALT);
  });

  it("is the signer's own Pot with a signer and no --owner, unlocking nothing it need not", async () => {
    // A keystore that names its address: read, never decrypted (there is no password to give).
    const named = file(
      "named.keystore.json",
      JSON.stringify({ address: OWNER.slice(2).toLowerCase(), version: 3, crypto: {} }),
    );
    const fromKeystore = JSON.parse(
      (await sauce("pot", "--chain", "base", "--keystore", named)).stdout,
    ) as { owner: string; pot: string };
    expect(fromKeystore).toMatchObject({ owner: OWNER, pot: v12PredictPot(OWNER) });
    // A raw key's own address (anvil's second dev account is OWNER).
    const fromKey = await sauce(
      ...["pot", "--chain", "base", "--private-key"],
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    expect(JSON.parse(fromKey.stdout)).toMatchObject({ owner: OWNER });
    // A keystore without one has to be unlocked: with no terminal, that needs --password-file.
    const unnamed = file("unnamed.keystore.json", JSON.stringify({ version: 3, crypto: {} }));
    const locked = await sauce("pot", "--chain", "base", "--keystore", unnamed);
    expect(locked.code).toBe(2);
    expect(locked.stderr).toMatch(/pass --password-env <NAME>, --password-file <path> or/);
  });

  it("refuses a missing owner, and an owner that is not the chain's kind of address", async () => {
    expect((await sauce("pot", "--chain", "base")).stderr).toMatch(/missing --owner <address>/);
    expect((await sauce("pot", "--owner", OWNER)).stderr).toMatch(/missing --chain/);
    const svm = await sauce("pot", "--owner", OWNER, "--chain", "solana");
    expect(svm.code).toBe(2);
    expect(svm.stderr).toMatch(/is not a Solana address \(a base58 public key\)/);
  });

  it("names the account a Solana transaction error gives only by its index", () => {
    const accounts = [
      "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
      "ComputeBudget111111111111111111111111111111",
      "DRBtuXHdgM2qjkC6rfZn6s1cMeU6rxauV5K9TVX5DpFs",
    ] as Address[];
    const labels = new Map([[accounts[2]!, "the Kitchen's fee config"]]);
    // As LiteSVM words it, and as a node's simulation does.
    expect(
      namingAccount(
        '"TransactionErrorInsufficientFundsForRent { account_index: 2 }"',
        accounts,
        labels,
      ),
    ).toBe(
      '"TransactionErrorInsufficientFundsForRent { account_index: 2 }": account 2 is ' +
        "DRBtuXHdgM2qjkC6rfZn6s1cMeU6rxauV5K9TVX5DpFs (the Kitchen's fee config), which the " +
        "transaction would leave below its rent-exempt minimum",
    );
    expect(namingAccount('{"InvalidAccountForFee":{"account_index":0}}', accounts)).toBe(
      '{"InvalidAccountForFee":{"account_index":0}}: account 0 is ' +
        "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    );
    // No index, or one past the message: the reason as it was.
    expect(namingAccount("the program threw", accounts)).toBe("the program threw");
    expect(namingAccount("x { account_index: 9 }", accounts)).toBe("x { account_index: 9 }");
  });

  it("names a Solana failure only for the program the logs show failing", () => {
    const engine = v12SvmEngineProgramId();
    const kitchen = v12SvmKitchenProgramId();
    const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const at = (code: number) => ({ InstructionError: [2, { Custom: code }] });
    const logs = (...failed: Array<[string, number]>) => [
      `Program ${kitchen} invoke [1]`,
      ...failed.map(
        ([program, code]) =>
          `Program ${program} failed: custom program error: 0x${code.toString(16)}`,
      ),
    ];
    const thrown = new TextEncoder().encode("too small");
    // The engine's revert, carried up through the Kitchen: the program's own text.
    expect(failureReason(at(0), logs([engine, 0], [kitchen, 0]), thrown)).toBe(
      'the program threw "too small"',
    );
    // The Kitchen's own error, by name.
    expect(failureReason(at(6012), logs([kitchen, 6012]))).toMatch(
      /^the Kitchen refused: ExecutionFeeExceedsMaximum/,
    );
    // SPL Token's code 0 is not a Sauce revert, and another program's 6012 is not the Kitchen's.
    expect(failureReason(at(0), logs([token, 0], [engine, 0], [kitchen, 0]), thrown)).toBe(
      `program ${token} failed with custom program error 0 (0x0); the logs say why`,
    );
    const anchor = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    expect(failureReason(at(6012), logs([anchor, 6012], [kitchen, 6012]))).toBe(
      `program ${anchor} failed with custom program error 6012 (0x177c); the logs say why`,
    );
    // The engine's own refusal, by name — a direct cook's fee cap, a pin that does not match.
    expect(failureReason(at(84), logs([engine, 84]))).toMatch(
      /^the engine refused: ExecutionFeeExceedsMaximum \(custom program error 84\): the execution fee is above/,
    );
    expect(failureReason(at(72), logs([engine, 72], [kitchen, 72]))).toMatch(
      /^the engine refused: CodeHashMismatch/,
    );
    // A code the engine does not use stays a code.
    expect(failureReason(at(999), logs([engine, 999]))).toBe(
      `program ${engine} failed with custom program error 999 (0x3e7); the logs say why`,
    );
    // A token program's refusal is read from the line it logged, for either token program; with
    // no such line it stays a code, as above.
    const token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    const refused = (program: string, said: string, code: number) => [
      `Program ${kitchen} invoke [1]`,
      `Program ${engine} invoke [2]`,
      `Program ${program} invoke [3]`,
      "Program log: Instruction: TransferChecked",
      `Program log: ${said}`,
      `Program ${program} failed: custom program error: 0x${code.toString(16)}`,
      `Program ${engine} failed: custom program error: 0x${code.toString(16)}`,
      `Program ${kitchen} failed: custom program error: 0x${code.toString(16)}`,
    ];
    expect(
      failureReason(
        at(67),
        refused(token2022, "Transferring, minting, and burning is paused on this mint", 67),
      ),
    ).toBe(
      "Token-2022 refused: Transferring, minting, and burning is paused on this mint (custom program error 67)",
    );
    expect(failureReason(at(17), refused(token, "Error: Account is frozen", 17))).toBe(
      "SPL Token refused: Account is frozen (custom program error 17)",
    );
  });

  it("refuses --via and --max-execution-fee on an EVM chain, whose cook is the Pot's", async () => {
    const program = file("evm-via.sauce.ts", "function main() {}\n");
    for (const flag of [
      ["--via", "engine"],
      ["--max-execution-fee", "5000"],
    ]) {
      const refused = await sauce("tx", program, "--chain", "base", "--owner", OWNER, ...flag);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(new RegExp(`${flag[0]} is for a Solana cook`));
    }
    const compiled = await sauce("compile", program, "--chain", "base", "--via", "engine");
    expect(compiled.code).toBe(2);
    expect(compiled.stderr).toMatch(/--via chooses how a Solana cook reaches the engine/);
  });

  it("names a Solana stock mint's accounts by its symbol in any case, under Token-2022", async () => {
    const solana = requireChain("solana");
    const owner = svmAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const pot = svmAddress("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T");
    const nvda = svmTokenRows(solana).find((row) => row.symbol === "NVDA_US")!;
    // A stock's symbol can carry a "_", and is found without regard to case.
    const given = parseAccounts([
      "source=pot:nvda_us",
      "mint=mint:NVDA_US",
      "program=program:tslax",
    ]);
    const { accounts } = await resolveTokenAccounts(given, owner, pot, solana);
    expect(accounts).toEqual({
      source: (
        await findAssociatedTokenPda({
          owner: pot,
          mint: svmAddress(nvda.mint),
          tokenProgram: svmAddress(TOKEN_2022_PROGRAM_ID),
        })
      )[0],
      mint: nvda.mint,
      program: TOKEN_2022_PROGRAM_ID,
    });
    // A symbol the cluster does not register names its other mints and counts its stocks.
    const stocks = svmTokenRows(solana).filter((row) => row.stock !== undefined).length;
    await expect(
      resolveTokenAccounts(parseAccounts(["held=pot:SPCXc"]), owner, pot, solana),
    ).rejects.toThrow(
      `SPCXc is not a mint solana registers (PYUSD, USDC, USDT, WSOL, and ${stocks} stock ` +
        "tokens: sauce globals --chain solana --stocks)",
    );
  });

  it("derives a Solana Pot as the Kitchen's PDA over (owner, salt), offline", async () => {
    const owner = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const out = JSON.parse(
      (await sauce("pot", "--chain", "solana", "--owner", owner, "--salt", "vault")).stdout,
    ) as Record<string, unknown>;
    const kitchen = svmAddress(v12SvmKitchenProgramId());
    const { address: pot } = await derivePotPda(
      kitchen,
      svmAddress(owner),
      hexToBytes(potSalt("vault")),
    );
    expect(out).toMatchObject({
      chain: "solana",
      pot,
      owner,
      salt: potSalt("vault"),
      kitchen,
      engine: v12SvmEngineProgramId(),
      instruction: {
        programAddress: kitchen,
        accounts: [
          { address: owner, role: "writable signer" },
          { address: v12SvmEngineProgramId(), role: "readonly" },
          { address: pot, role: "writable" },
          { address: "11111111111111111111111111111111", role: "readonly" },
        ],
      },
    });
    expect(
      (await sauce("pot", "--chain", "solana", "--owner", owner, "--format", "cast")).stderr,
    ).toMatch(/--format cast prints an EVM transaction/);
  });
});

describe("flags in any order", () => {
  const SPLIT = "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n";

  it("reads a flag after main's arguments as a flag, and -- makes the rest arguments", async () => {
    const program = file("split.sauce.ts", SPLIT);
    const stdout = (run: Run): Record<string, unknown> => {
      expect(run.code).toBe(0);

      return JSON.parse(run.stdout) as Record<string, unknown>;
    };
    const before = stdout(
      await sauce(
        "tx",
        program,
        "--chain",
        "base",
        "--owner",
        OWNER,
        "--value",
        "7",
        "--args",
        RECIPIENT,
        "5",
      ),
    );
    // The same flags after --args, in another order, with --flag=value too.
    const after = stdout(
      await sauce(
        "tx",
        program,
        "--args",
        RECIPIENT,
        "--value=7",
        "5",
        "--chain",
        "base",
        "--owner",
        OWNER,
      ),
    );
    expect(after).toEqual(before);
    expect(before.value).toBe("7");
    // After `--`, a word that looks like a flag is an argument.
    const escaped = await sauce(
      "tx",
      program,
      "--chain",
      "base",
      "--owner",
      OWNER,
      "--value",
      "0",
      "--args",
      RECIPIENT,
      "--",
      "--value",
    );
    expect(escaped.code).toBe(2);
    expect(escaped.stderr).toMatch(/--args: .*amount/);
  });

  it("says what does a retired flag's work, rather than an unknown option", async () => {
    const program = file("pay.sauce.ts", PAY);
    for (const flag of [
      ["--intent-creator", OWNER],
      [`--intent-creator=${OWNER}`],
      ["--intent-refundee", OWNER],
    ]) {
      const run = await sauce("compile", program, "--chain", "base", ...flag);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(
        /`--intent-(creator|refundee)` is gone: an intent names its refundee in the file: `hop\(\{ send, refundee: refundTo \}\)`/,
      );
    }
  });

  it("names a flag the command does not take, and why, instead of an unknown option", async () => {
    const program = file("split.sauce.ts", SPLIT);
    const cases: Array<[string[], RegExp]> = [
      [
        ["tx", program, "--chain", "base", "--owner", OWNER, "--keystore", "k.json"],
        /--keystore is not an option of sauce tx: tx signs nothing: it prints the transaction unsigned/,
      ],
      [
        ["tx", program, "--chain", "solana", "--owner", OWNER, "--keypair", "id.json"],
        /--keypair is not an option of sauce tx: tx signs nothing/,
      ],
      [
        ["compile", program, "--chain", "base", "--auto-approve"],
        /--auto-approve is not an option of sauce compile: compile has nothing to ask \(sauce run, sauce intent, sauce pot, sauce intent publish, sauce intent fill, sauce intent prove, sauce intent claim, sauce intent refund, sauce intent cancel take it\)/,
      ],
      [
        ["globals", "--chain", "base", "--rpc-url", "http://x"],
        /globals reads nothing from a chain/,
      ],
      [
        ["compile", program, "--chain", "base", "--keystore", "k.json"],
        /--keystore is not an option of sauce compile: compile signs nothing \(sauce simulate, sauce run/,
      ],
      [["compile", program, "--chain", "base", "--nope"], /unknown option --nope/],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce(...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
    // `pot` takes --auto-approve, which approves nothing there: --deploy itself is the approval.
    const pot = await sauce("pot", "--owner", OWNER, "--chain", "base", "--auto-approve");
    expect(pot.code).toBe(0);
  });

  it("says so when one argument holds several flags, and prints none of their values", async () => {
    const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    // What zsh passes for `sauce pot --chain base --deploy $FLAGS`: one word.
    const run = await sauce(
      "pot",
      "--chain",
      "base",
      "--deploy",
      `--private-key ${key} --config sauce.config.json`,
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /one argument holds several words, --private-key, --config and their values, with spaces/,
    );
    expect(run.stderr).toMatch(/zsh does not split an unquoted \$VARIABLE/);
    expect(run.stderr).not.toContain(key.slice(2, 12));
  });
});

describe("what main returned", () => {
  const word = (value: bigint) => numberToHex(value, { size: 32 }).slice(2);
  const data = (...values: bigint[]) => `0x${values.map(word).join("")}` as Hex;
  const base = requireChain("base");

  it("reads the cook's return data as the type main declares", async () => {
    const { decodeReturned, returnedLine } = await import("../src/cli/returned.js");
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    expect(decodeReturned("Address", data(BigInt(usdc)), base)).toBe(usdc);
    expect(decodeReturned("Uint256", data(42n), base)).toBe("42");
    expect(decodeReturned("bool", data(1n), base)).toBe(true);
    // An array: its elements one word each, no length in front.
    expect(decodeReturned("Uint256[]", data(1n, 2n, 3n), base)).toEqual(["1", "2", "3"]);
    expect(decodeReturned("Uint256[]", "0x", base)).toEqual([]);
    // A record: its fields one word each, in order; an array of records, one after another.
    const record = "{ token: Address, out: Uint256 }";
    expect(decodeReturned(record, data(BigInt(usdc), 5n), base)).toEqual({ token: usdc, out: "5" });
    expect(decodeReturned(`${record}[]`, data(BigInt(usdc), 5n, BigInt(usdc), 6n), base)).toEqual([
      { token: usdc, out: "5" },
      { token: usdc, out: "6" },
    ]);
    // bytes as they are.
    expect(decodeReturned("bytes", "0x1234", base)).toBe("0x1234");
    // A shape that does not fit is not guessed at.
    expect(decodeReturned("Uint256", data(1n, 2n), base)).toBeUndefined();
    expect(decodeReturned(`${record}[]`, data(1n, 2n, 3n), base)).toBeUndefined();
    expect(returnedLine("Uint256", data(1n, 2n), base)).toBe(
      "main returns Uint256: the data above does not read as one",
    );
    expect(returnedLine(record, data(BigInt(usdc), 5n), base)).toBe(
      `main returns ${record}: { token: ${usdc}, out: 5 }`,
    );
    // On Solana an address is a 32-byte key, shown in base58.
    const solana = requireChain("solana");
    const mint = routes.registryTokens(solana).USDC!;
    expect(decodeReturned("Address", mint.address, solana)).toBe(mint.mint);
  });

  it("reads main's declared return type off the compile, an interface spelled out", async () => {
    const { entryReturnType } = await import("../src/routes/entry.js");
    const returns = (text: string) =>
      entryReturnType(compileSauceProgram("base", text).entrySignature);
    expect(returns("function main(): Address {\n  return 0;\n}\n")).toBe("Address");
    expect(returns("function main() {\n}\n")).toBeUndefined();
    expect(returns("function main(): void {\n}\n")).toBeUndefined();
    expect(
      returns(
        "interface Out { token: Address; out: Uint256 }\nfunction main(): Out[] {\n  return [];\n}\n",
      ),
    ).toBe("{ token: Address, out: Uint256 }[]");
    // Compiled for its arguments, main still reports what it returns.
    expect(
      entryReturnType(
        compileSauceProgram("base", "function main(a: Uint256): Uint256 {\n  return a;\n}\n", {
          args: [5n],
        }).entrySignature,
      ),
    ).toBe("Uint256");
  });
});

describe("a program from stdin", () => {
  const PROGRAM = "function main(to: Address) {\n  USDC.transfer(to, 5n);\n}\n";
  const piped = (text: string) => ({ readStdin: () => text });

  it("compiles `-` as the program stdin carries, byte for byte as the file", async () => {
    const fromFile = await sauce("compile", file("pay.sauce.ts", PROGRAM), "--chain", "base");
    const fromStdin = await sauceWith(piped(PROGRAM), "compile", "-", "--chain", "base");
    expect(fromStdin.code).toBe(0);
    expect(fromStdin.stdout).toBe(fromFile.stdout);
    // Read only when asked for: a missing file operand never falls back to stdin.
    const none = await sauceWith(
      {
        readStdin: () => {
          throw new Error("read stdin");
        },
      },
      "compile",
      "--chain",
      "base",
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(
      /missing <file>: the SauceScript program, or - to read it from stdin/,
    );
  });

  it("resolves its relative imports against --source-dir, and says so when one is missing", async () => {
    file("lib/fee.js", "export function fee(amount) { return amount / 100n; }\n");
    const program =
      'import { fee } from "./lib/fee.js";\nfunction main() {\n  require(fee(AMOUNT) > 0n);\n}\n';
    const args = ["compile", "-", "--chain", "base", "--define", "AMOUNT=1000"];
    const there = await sauceWith(piped(program), ...args, "--source-dir", work);
    expect(there.stderr).toBe("");
    expect(there.code).toBe(0);
    // From the test's own directory, ./lib/fee.js is not there.
    const missing = await sauceWith(piped(program), ...args);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("<stdin> does not compile for base");
    expect(missing.stderr).toContain(
      "hint: the program came from stdin, so its relative imports resolve against",
    );
    expect(missing.stderr).toContain("pass --source-dir <dir>");
  });

  it("takes apart what stdin carries for inspect: hex, or a program", async () => {
    const compiled = (
      await sauce("compile", file("pay.sauce.ts", PROGRAM), "--chain", "base")
    ).stdout.trim();
    const hex = await sauceWith(piped(`${compiled}\n`), "inspect", "-", "--chain", "base");
    const direct = await sauce("inspect", compiled, "--chain", "base");
    expect(hex.code).toBe(0);
    expect(hex.stdout).toBe(direct.stdout);
    const source = await sauceWith(piped(PROGRAM), "inspect", "-", "--chain", "base");
    expect(source.code).toBe(0);
    expect(source.stdout).toContain("<stdin> for base (evm)");
    const both = await sauceWith(piped(compiled), "inspect", "-", "--source", "-");
    expect(both.code).toBe(2);
    expect(both.stderr).toMatch(/stdin carries one thing/);
  });

  it("asks nothing on a spent stdin: a keystore needs a password source, approvals --auto-approve", async () => {
    // jest's stdin is no terminal and the program used it: no password can be asked for.
    const keystore = await sauceWith(
      piped(PROGRAM),
      ...["run", "-", "--chain", "base", "--rpc-url", "http://127.0.0.1:1"],
      ...["--keystore", join(SDK, "test/fixtures/cli/anvil-2.keystore.json"), "--args", OWNER],
    );
    expect(keystore.code).toBe(2);
    expect(keystore.stderr).toMatch(
      /to ask for the password on: pass --password-env <NAME>, --password-file <path> or/,
    );
  });
});

describe("which terminal a question goes to", () => {
  const stdin = (isTTY: boolean) =>
    Object.assign(new PassThrough(), { isTTY }) as unknown as TerminalChoice["stdin"];
  const controlling = { input: new PassThrough(), output: new PassThrough(), close: () => {} };
  const choose = (stdinRead: boolean, isTTY: boolean, tty?: Terminal) =>
    chooseTerminal({
      stdinRead,
      stdin: stdin(isTTY),
      stderr: new PassThrough(),
      controlling: () => tty,
    });

  it("asks on stdin while it is a terminal nothing has read", () => {
    expect(choose(false, true, controlling)?.input).not.toBe(controlling.input);
    expect(choose(false, true, controlling)).toBeDefined();
  });

  it("asks on the controlling terminal once stdin carried the program", () => {
    expect(choose(true, false, controlling)).toBe(controlling);
    expect(choose(true, true, controlling)).toBe(controlling);
  });

  it("asks nowhere with no terminal at all, and never falls back to an unread pipe", () => {
    expect(choose(true, false, undefined)).toBeUndefined();
    // A pipe nothing read is not a terminal, and is not swapped for /dev/tty either.
    expect(choose(false, false, controlling)).toBeUndefined();
  });

  it("reads a yes, and anything else as no, at the terminal it is given", async () => {
    for (const [typed, answer] of [
      ["y\n", true],
      ["yes\n", true],
      ["\n", false],
      ["nope\n", false],
    ] as const) {
      const input = new PassThrough();
      const output = new PassThrough();
      const asked = confirmOn({ input, output, close: () => {} }, "Deploy it now? [y/N] ");
      input.write(typed);
      expect(await asked).toBe(answer);
    }
  });
});

describe("waiting for a deployed Pot", () => {
  const POT = "0x1111111111111111111111111111111111111111";
  const answering = (answers: Array<string | Error>) => {
    const asked: string[] = [];
    const client = {
      getCode: async ({ address }: { address: string }) => {
        asked.push(address);
        const next = answers.shift() ?? "0x";
        if (next instanceof Error) throw next;

        return next === "0x" ? undefined : next;
      },
    } as unknown as PublicClient;

    return { client, asked };
  };

  it("asks past an endpoint that has not seen the deployment yet", async () => {
    const { client, asked } = answering(["0x", new Error("header not found"), "0x", "0x6000"]);
    await awaitPot(client, POT, 7n, { tries: 5, delayMs: 1 });
    expect(asked).toHaveLength(4);
  });

  it("fails, naming the block, when the endpoint never shows the code", async () => {
    const { client } = answering([]);
    await expect(awaitPot(client, POT, 7n, { tries: 3, delayMs: 1 })).rejects.toThrow(
      /deployed in block 7, but the endpoint still shows no code there/,
    );
  });

  it("reads a Pot's registered balances but not its chain's tokenized stocks, one read each", async () => {
    const read: string[] = [];
    const client = {
      getBalance: async () => 7n,
      readContract: async ({ address }: { address: string }) => {
        read.push(getAddress(address));
        return 5n;
      },
    } as unknown as PublicClient;
    const ethereum = requireChain("ethereum");
    const rows = routes.TOKEN_REGISTRY[ethereum.id]!;
    const plain = rows.filter((row) => row.stock === undefined);
    // Ethereum has over a thousand stock tokens: none of them is read.
    expect(rows.length - plain.length).toBeGreaterThan(1000);
    const held = await registeredBalances(client, ethereum, POT);
    expect(read).toHaveLength(plain.length);
    expect(held.tokens.map((token) => token.symbol)).toEqual(plain.map((row) => row.symbol));
    expect(held.native).toBe(7n);
    expect(held.tokens.find((token) => token.symbol === "USDC")).toMatchObject({ balance: 5n });
  });

  it("waits for the endpoint to reach a transaction's block, and gives up quietly", async () => {
    const heights: Array<bigint | Error> = [5n, new Error("timeout"), 6n, 7n];
    let asked = 0;
    const client = {
      getBlockNumber: async () => {
        asked++;
        const next = heights.shift() ?? 6n;
        if (next instanceof Error) throw next;

        return next;
      },
    } as unknown as PublicClient;
    await caughtUp(client, 7n, { tries: 10, delayMs: 1 });
    expect(asked).toBe(4);
    // Never there: it returns rather than fail a transaction that did succeed.
    asked = 0;
    await caughtUp(client, 100n, { tries: 3, delayMs: 1 });
    expect(asked).toBe(3);
  });

  it("waits on Solana for a created account to show, reading a failed request as not yet", async () => {
    const answers: Array<null | Error | object> = [null, new Error("503"), {}];
    let asked = 0;
    const rpc = {
      getAccountInfo: () => ({
        send: async () => {
          asked++;
          const next = answers.shift() ?? null;
          if (next instanceof Error) throw next;

          return { value: next };
        },
      }),
    } as unknown as Parameters<typeof awaitAccount>[0];
    const pot = svmAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await awaitAccount(rpc, "http://rpc", pot, "the Pot", { tries: 5, delayMs: 1 });
    expect(asked).toBe(3);
    await expect(
      awaitAccount(rpc, "http://rpc", pot, "the Pot", { tries: 2, delayMs: 1 }),
    ).rejects.toThrow(/the Pot 9WzD\w+ was created, but the cluster still does not show it/);
  });
});

describe("sauce price", () => {
  const WETH_BASE = "0x4200000000000000000000000000000000000006";

  it("prints the pool's sqrtPriceX96 for the chain's token order, and each direction's limits", async () => {
    const out = json(await sauce("price", "--chain", "base", "WETH", "USDC", "2700", "--json"));
    // WETH is token0 on Base: the price is the SDK's conversion with WETH as the base.
    const sqrt = root.sqrtPriceX96FromPrice("2700", {
      baseDecimals: 18,
      quoteDecimals: 6,
      baseIsToken0: true,
    });
    expect(out).toEqual({
      chain: "base",
      price: "2700",
      // What it means, in words, and the same price the other way round.
      means: "2700 USDC per WETH",
      inverse: { price: "0.00037037037037037", means: "0.00037037037037037 WETH per USDC" },
      base: { symbol: "WETH", address: WETH_BASE, decimals: 18 },
      quote: {
        symbol: "USDC",
        address: getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
        decimals: 6,
      },
      token0: "WETH",
      token1: "USDC",
      sqrtPriceX96: sqrt.toString(),
      units: PRICE_UNITS,
      // Selling WETH: as the distributed swap's maxPrice, WETH units paid per USDC unit bought,
      // 1e18 / 2700e6 times 1e18, rounded down; as minAvgPrice, 2700e6 USDC units per 1e18 WETH
      // units, times 1e18.
      sell: {
        tokenIn: "WETH",
        tokenOut: "USDC",
        zeroForOne: true,
        sqrtPriceLimitX96: sqrt.toString(),
        limit: "floor",
        maxPrice: (10n ** 36n / (2700n * 10n ** 6n)).toString(),
        maxAvgPrice: (10n ** 36n / (2700n * 10n ** 6n)).toString(),
        minAvgPrice: "2700000000",
      },
      // Buying WETH: maxPrice is USDC units paid per WETH unit, times 1e18 — 2700 x 10^(18 + 6 -
      // 18) — and minAvgPrice the other way round, WETH units per USDC unit, rounded up.
      buy: {
        tokenIn: "USDC",
        tokenOut: "WETH",
        zeroForOne: false,
        sqrtPriceLimitX96: sqrt.toString(),
        limit: "ceiling",
        maxPrice: "2700000000",
        maxAvgPrice: "2700000000",
        minAvgPrice: ((10n ** 36n + 2700n * 10n ** 6n - 1n) / (2700n * 10n ** 6n)).toString(),
      },
    });
    const text = await sauce("price", "--chain", "base", "WETH", "USDC", "2700");
    expect(text.stdout.split("\n")[0]).toBe(
      "2700 USDC per WETH on base: 1 WETH = 2700 USDC, 1 USDC = 0.00037037037037037 WETH",
    );
    expect(text.stdout).toContain(`sqrtPriceX96  ${sqrt}`);
    // Each number says which way round it is, and which the distributed swap takes.
    expect(text.stdout).toMatch(
      /Buying WETH \(USDC in, WETH out\):\n.*\n {2}maxPrice +2700000000 +USDC units paid per WETH unit bought, times 1e18: the distributed swap's maxPrice\n {2}maxAvgPrice +2700000000 +the same, as its maxAvgPrice/,
    );
    expect(text.stdout).toMatch(
      /minAvgPrice +2700000000 +the other way round, USDC units received per WETH unit, times 1e18: a floor for out \* 1e18 >= minAvgPrice \* spent, never a maxAvgPrice/,
    );
    // Said in words, the same price: `2700 USDC per WETH`.
    const worded = await sauce("price", "--chain", "base", "2700", "USDC", "per", "WETH");
    expect(worded.stdout).toBe(text.stdout);
  });

  it("prices a stock token by its registry decimals, its symbol in any case", async () => {
    const out = json(await sauce("price", "--chain", "base", "spcxc", "USDC", "148.7", "--json"));
    // USDC sorts below Coinbase's 0xb2… address: SPCXc is token1, with 8 decimals.
    const sqrt = root.sqrtPriceX96FromPrice("148.7", {
      baseDecimals: 8,
      quoteDecimals: 6,
      baseIsToken0: false,
    });
    expect(out).toMatchObject({
      means: "148.7 USDC per SPCXc",
      base: { symbol: "SPCXc", address: "0xb2000000000000000000007b9fcbd005511aCBd5", decimals: 8 },
      token0: "USDC",
      token1: "SPCXc",
      sqrtPriceX96: sqrt.toString(),
    });
  });

  /**
   * A Base endpoint whose Uniswap V3 factory has a WETH/USDC pool at each tier `pools` names, each
   * with its liquidity and price (USDC per WETH); `getPool` answers zero at every other tier.
   */
  async function v3Endpoint(
    pools: Readonly<Record<number, { liquidity: bigint; price: string }>>,
  ): Promise<{ url: string; close: () => void; poolAt: (fee: number) => string }> {
    const factory = BigInt(routes.chainDefines(requireChain("base")).UniswapV3_Factory as bigint);
    const poolAt = (fee: number) =>
      getAddress(`0x${(0xb00000 + fee).toString(16).padStart(40, "0")}`);
    const byPool = new Map(
      Object.entries(pools).map(([fee, pool]) => [BigInt(poolAt(Number(fee))), pool]),
    );
    const word = (value: bigint) => numberToHex(value, { size: 32 });
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const call = JSON.parse(body) as { id: number; method: string; params: unknown[] };
        const { to, data } = (call.params?.[0] ?? {}) as { to?: string; data?: string };
        let result: unknown = null;
        if (call.method === "eth_chainId") result = "0x2105";
        else if (call.method === "eth_call" && BigInt(to!) === factory) {
          const fee = Number(BigInt(`0x${data!.slice(-64)}`));
          result = word(pools[fee] === undefined ? 0n : BigInt(poolAt(fee)));
        } else if (call.method === "eth_call" && byPool.has(BigInt(to!))) {
          const pool = byPool.get(BigInt(to!))!;
          const sqrt = root.sqrtPriceX96FromPrice(pool.price, {
            baseDecimals: 18,
            quoteDecimals: 6,
            baseIsToken0: true,
          });
          result = data!.startsWith("0x1a686502")
            ? word(pool.liquidity) // liquidity()
            : `${word(sqrt)}${"0".repeat(64 * 6)}`; // slot0()
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    return {
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      close: () => server.close(),
      poolAt,
    };
  }

  it("reads the pair's price now with an endpoint, and says when the one given is the wrong way round", async () => {
    const endpoint = await v3Endpoint({ 500: { liquidity: 10n ** 18n, price: "4100" } });
    try {
      const right = await sauce(
        ...["price", "--chain", "base", "4000", "USDC", "per", "WETH"],
        ...["--rpc-url", endpoint.url, "--json"],
      );
      expect(right.code).toBe(0);
      expect(right.stderr).toBe("");
      expect(JSON.parse(right.stdout)).toMatchObject({
        live: { pool: endpoint.poolAt(500), fee: 500, price: "4100", means: "4100 USDC per WETH" },
      });
      // Haiku's reading: 2500 WETH per USDC, ten-millionfold off — and the right way round named.
      const wrong = await sauce(
        ...["price", "--chain", "base", "USDC", "WETH", "2500", "--rpc-url", endpoint.url],
      );
      expect(wrong.code).toBe(0);
      expect(wrong.stderr).toContain(
        "the price given, 2500 WETH per USDC, is about 10^7 times off the Uniswap V3 pool",
      );
      expect(wrong.stderr).toContain(
        "it looks the wrong way round. For 2500 USDC per WETH, run " +
          "`sauce price --chain base 2500 USDC per WETH`",
      );
      // 10x is where it warns: 11x warns, 9x does not, and neither says "the wrong way round".
      const far = await sauce(
        ...["price", "--chain", "base", "45100", "USDC", "per", "WETH", "--rpc-url", endpoint.url],
      );
      expect(far.stderr).toContain("is 11x off the Uniswap V3 pool");
      expect(far.stderr).not.toContain("wrong way round");
      const near = await sauce(
        ...["price", "--chain", "base", "36900", "USDC", "per", "WETH", "--rpc-url", endpoint.url],
      );
      expect(near.stderr).toBe("");
    } finally {
      endpoint.close();
    }
  });

  it("reads the deepest of the pair's pools, and says when there is none to read", async () => {
    // Three tiers: the deepest is the 0.3% pool, whatever the others' prices.
    const several = await v3Endpoint({
      100: { liquidity: 5n, price: "1000" },
      500: { liquidity: 10n ** 18n, price: "4100" },
      3000: { liquidity: 10n ** 20n, price: "4200" },
    });
    try {
      const out = json(
        await sauce(
          ...["price", "--chain", "base", "4150", "USDC", "per", "WETH"],
          ...["--rpc-url", several.url, "--json"],
        ),
      );
      expect(out.live).toMatchObject({ pool: several.poolAt(3000), fee: 3000, price: "4200" });
    } finally {
      several.close();
    }
    // Pools with no liquidity are no price at all.
    const empty = await v3Endpoint({ 500: { liquidity: 0n, price: "4100" } });
    try {
      const run = await sauce(
        ...["price", "--chain", "base", "4150", "USDC", "per", "WETH", "--rpc-url", empty.url],
      );
      expect(run.code).toBe(0);
      expect(run.stderr).toContain(
        "no Uniswap V3 pool for WETH/USDC on base to read the price now from",
      );
    } finally {
      empty.close();
    }
  });

  it("reads a pool's sqrtPriceX96 back as the price, and takes an address with its decimals", async () => {
    const back = json(
      await sauce(
        "price",
        "--chain",
        "base",
        WETH_BASE,
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:6",
        "--sqrt-price-x96",
        "4124432773472966290820821",
        "--json",
      ),
    );
    expect(back).toMatchObject({ price: "2710", sell: { minAvgPrice: "2710000000" } });
    // USDC as the base, on Arbitrum where it is token1: the quote's floor when selling it.
    const usdc = json(
      await sauce("price", "--chain", "arbitrum", "USDC", "WETH", "0.0004", "--json"),
    );
    expect(usdc).toMatchObject({
      token0: "WETH",
      sell: { tokenIn: "USDC", zeroForOne: false, limit: "ceiling" },
      buy: { tokenIn: "WETH", zeroForOne: true, limit: "floor", minAvgPrice: "2500000000" },
    });
  });

  it("names what it cannot price, exiting 2", async () => {
    const cases: Array<[string[], RegExp]> = [
      [["--chain", "solana", "WETH", "USDC", "1"], /on an EVM chain; solana has none/],
      [["--chain", "base", "WETH", "DAI", "1"], /DAI is not a token base registers/],
      [["--chain", "base", "WETH", `0x${"12".repeat(20)}`, "1"], /give them as 0x/],
      [["--chain", "base", "WETH", "USDC"], /missing <price>/],
      [["--chain", "base", "WETH"], /missing the pair: <price> <quote> per <base>/],
      [["--chain", "base", "WETH", "USDC", "1", "--sqrt-price-x96", "1"], /not both/],
      [["--chain", "base", "WETH", "USDC", "1e3"], /'1e3' is not a price/],
      [["--chain", "base", "WETH", "USDC:18", "1"], /USDC has 6 decimals, not 18/],
      [["--chain", "base", "WETH", "WETH", "1"], /WETH is both/],
      [["--chain", "base", "WETH", "USDC", "--sqrt-price-x96", "5"], /outside the range/],
      [
        ["--chain", "base", "WETH", "USDC", "1", "--pool", `0x${"12".repeat(20)}`],
        /give <price>, --sqrt-price-x96 or --pool: one of them/,
      ],
      [["--chain", "base", "WETH", "USDC", "--pool", "0x12"], /--pool: '0x12' is not/],
      [
        ["--chain", "base", "WETH", "USDC", "--pool", `0x${"12".repeat(20)}`],
        /missing --rpc-url <url> \(or --config <file>\)/,
      ],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce("price", ...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
  });
});

describe("the CLI stays out of the browser-facing surface", () => {
  it("is exported by no barrel", async () => {
    const cli = [
      await import("../src/cli/run.js"),
      await import("../src/cli/commands.js"),
      await import("../src/cli/args.js"),
      await import("../src/cli/skills.js"),
      await import("../src/cli/init.js"),
      await import("../src/cli/signer.js"),
      await import("../src/cli/chain.js"),
      await import("../src/cli/publish.js"),
      await import("../src/cli/globals.js"),
      await import("../src/cli/inspect.js"),
      await import("../src/cli/verify.js"),
      await import("../src/cli/solana.js"),
      await import("../src/cli/price.js"),
      await import("../src/cli/pools.js"),
      await import("../src/cli/report.js"),
      await import("../src/cli/intents.js"),
      await import("../src/cli/receipt.js"),
      await import("../src/cli/terminal.js"),
      await import("../src/cli/returned.js"),
    ].flatMap((module) => Object.keys(module));
    expect(cli.length).toBeGreaterThan(0);
    const routes = root.routes as Record<string, unknown>;
    expect(cli.filter((name) => name in root || name in routes)).toEqual([]);
  });

  it("has a chain to name for every canonical slug", () => {
    expect(requireChain("solana").kind).toBe("svm");
  });

  it("loads LiteSVM, a dependency for the command's rehearsals alone, lazily and from it alone", () => {
    // `git grep` over the shipped source: every file that names the package, and how.
    const naming = execFileSync(
      "git",
      ["grep", "-l", "litesvm", "--", "sdk/src", "actions/src", "mcp/src"],
      {
        cwd: join(SDK, ".."),
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n");
    expect(naming).toEqual(["sdk/src/cli/svm-fork.ts"]);
    const fork = readFileSync(join(SDK, "src/cli/svm-fork.ts"), "utf8");
    // A type-only import, which compiles to nothing, and the one dynamic import.
    expect(fork.match(/^import .* from "litesvm";$/gm)).toEqual([
      'import type { Clock as ClockType, LiteSVM as LiteSVMType } from "litesvm";',
    ]);
    expect(fork.match(/await import\("litesvm"\)/g)).toHaveLength(1);
  });
});

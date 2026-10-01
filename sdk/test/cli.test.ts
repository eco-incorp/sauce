/**
 * The `sauce` command, in process: its flags, what each command prints, and that it compiles a
 * file exactly as `openRoute` compiles a route body. Executing what it prints is `cli.e2e.test.ts`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { address as svmAddress } from "@solana/kit";
import {
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
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
import { awaitPot } from "../src/cli/chain.js";
import { castSend } from "../src/cli/commands.js";
import { failureReason } from "../src/cli/solana.js";
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
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";
import { encodeCompactArguments } from "../src/compact-arguments.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x3333333333333333333333333333333333333333";
const PROVER = "0x4444444444444444444444444444444444444444";

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
  let stdout = "";
  let stderr = "";
  const ran: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
  const io: CliIo = {
    ...nodeIo(),
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

describe("sauce compile", () => {
  it("compiles a file byte-for-byte as openRoute compiles the same body", async () => {
    const run = await sauce(
      "compile",
      file("pay.sauce.ts", PAY),
      "--chain",
      "ethereum",
      ...PAY_DEFINES,
    );
    expect(run.code).toBe(0);
    const built = openRoute("ethereum", PAY, {
      deadline: 2_000_000_000n,
      defines: { RECIPIENT: BigInt(RECIPIENT), AMOUNT: 1000n },
    }).reward({ source: "base", creator: CREATOR, prover: PROVER, nativeAmount: 0n });
    expect(run.stdout).toBe(`${bytesToHex(built.compiled.bytecode[0]!)}\n`);
  });

  it("has the chain's ambient names a bare compileSauceRoute does not: chainId and @sauce/token", async () => {
    const body = "require(chainId == 8453n);\ntransfer(USDC, RECIPIENT, 5n);\n";
    const run = await sauce(
      "compile",
      file("ambient.sauce.ts", body),
      "--chain",
      "base",
      ...PAY_DEFINES,
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
      entryEncoding: "abi-v1",
      entryParams: [],
      entrySchema: null,
      compiler: { name: "@eco-incorp/sauce-compiler", version: compiler.version },
      engine: {
        release: "v12-evm",
        version: release.version,
        commit: release.commit,
        address: getAddress(v12EngineAddress()),
      },
    });
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
      "hint: if RECIPIENT is a value you supply, pass --define RECIPIENT=<value>",
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
      /hint: USDT is not a registered token on base \(it has USDC, WETH\)/,
    );
  });

  it("builds an intent the program opens, naming each setting it lacks", async () => {
    const body = [
      "const amount = USDC.balanceOf(ctx.self());",
      "Arbitrum(() => {",
      "  USDC.transfer(RECIPIENT, amount);",
      "}).reward({ tokens: [{ token: USDC, amount }] });",
      "",
    ].join("\n");
    const program = file("intent.sauce.ts", body);
    const recipient = ["--define", `RECIPIENT=${RECIPIENT}`];
    const noDeadline = await sauce("compile", program, "--chain", "base", ...recipient);
    expect(noDeadline.code).toBe(1);
    expect(noDeadline.stderr).toMatch(
      /needs a `deadline`[^]*hint: pass --intent-deadline <unix seconds>/,
    );
    const noCreator = await sauce(
      "compile",
      program,
      "--chain",
      "base",
      ...recipient,
      "--intent-deadline",
      "2000000000",
    );
    expect(noCreator.stderr).toMatch(/hint: pass --intent-creator <address>/);
    const built = await sauce(
      "compile",
      program,
      "--chain",
      "base",
      ...recipient,
      "--intent-deadline",
      "2000000000",
      "--intent-creator",
      CREATOR,
    );
    expect(built.code).toBe(0);
    const viaOpenRoute = openRoute("base", body, {
      deadline: 2_000_000_000n,
      creator: CREATOR,
      defines: { RECIPIENT: BigInt(RECIPIENT) },
    }).reward({ source: "ethereum", creator: CREATOR, prover: PROVER, nativeAmount: 0n });
    expect(built.stdout).toBe(`${bytesToHex(viaOpenRoute.compiled.bytecode[0]!)}\n`);
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
      `It must be deployed (sauce pot --deploy --owner ${OWNER} --chain ethereum --keystore <its keystore>)`,
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
      `sauce pot --deploy --owner ${OWNER} --chain ethereum --salt treasury --keystore <its keystore>`,
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
    const other = await sauce(
      "tx",
      pay(),
      "--chain",
      "base",
      "--owner",
      OWNER,
      "--config",
      config,
      "--value",
      "0",
    );
    expect(other.stderr).toMatch(/has no rpcUrls entry for base \(chain id 8453\)/);
  });
});

describe("sauce publish, offline", () => {
  const INTENT = [
    "// @chain arbitrum",
    "Base(() => {",
    "  USDC.transfer(RECIPIENT, 5n);",
    "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
    "",
  ].join("\n");
  const FLAGS = [
    "--define",
    `RECIPIENT=${RECIPIENT}`,
    "--intent-deadline",
    "2000000000",
    "--intent-creator",
    CREATOR,
  ];

  it("prints each fixed intent's hash and unsigned Portal transactions", async () => {
    const run = await sauce(
      "publish",
      file("bridge.sauce.ts", INTENT),
      ...FLAGS,
      "--format",
      "json",
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as {
      chainId: number;
      intents: Array<{ intentHash: string; destination: string; transactions: unknown[] }>;
    };
    const [intent] = compileSauceProgram("arbitrum", INTENT, {
      defines: { RECIPIENT: BigInt(RECIPIENT) },
      intents: { deadline: 2_000_000_000n, creator: CREATOR },
    }).intents;
    expect(out.chainId).toBe(42161);
    expect(out.intents).toEqual([
      {
        intentHash: routes.hashIntent(intent!.intent).intentHash,
        destination: "base",
        transactions: [
          expect.objectContaining({ what: expect.stringMatching(/^approve /) }),
          expect.objectContaining({ what: "publishAndFund", value: "0" }),
        ],
      },
    ]);
    expect(run.stderr).toMatch(/Approvals are planned without reading the wallet's allowance/);
    const cast = await sauce(
      "publish",
      file("bridge.sauce.ts", INTENT),
      ...FLAGS,
      "--format",
      "cast",
    );
    expect(cast.stdout.trim().split("\n")).toHaveLength(2);
    expect(cast.stdout).toMatch(
      /^cast send 0x[0-9a-fA-F]{40} 0x[0-9a-f]+ --value 0 --rpc-url <RPC_URL>/m,
    );
  });

  it("refuses a file with no intent, or with runtime arguments, before any network", async () => {
    const none = await sauce(
      "publish",
      file("none.sauce.ts", "require(chainId == 1n);\n"),
      "--chain",
      "1",
      "--format",
      "json",
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/opens no intent — there is nothing to publish/);
    const typed = await sauce(
      "publish",
      file(
        "typed.sauce.ts",
        "function main(recipient: Address) {\n  Base(() => {\n    USDC.transfer(recipient, 5n);\n  }).reward({ tokens: [{ token: USDC, amount: 7n }] });\n}\n",
      ),
      "--chain",
      "arbitrum",
      ...FLAGS.slice(2),
      "--format",
      "json",
    );
    expect(typed.code).toBe(2);
    expect(typed.stderr).toMatch(
      /takes arguments at run time \(main\(recipient\)\), which only a run has/,
    );
  });

  it("needs an endpoint to send, and a wallet to send from", async () => {
    const run = await sauce("publish", file("bridge.sauce.ts", INTENT), ...FLAGS);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/missing --rpc-url <url> \(or --config <file>\)/);
  });
});

describe("sauce fill, offline", () => {
  const INTENT = [
    "// @chain arbitrum",
    "Base(() => {",
    "  Token(0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n).transfer(RECIPIENT, 5n);",
    "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
    "",
  ].join("\n");
  const FLAGS = [
    "--define",
    `RECIPIENT=${RECIPIENT}`,
    "--intent-deadline",
    "2000000000",
    "--intent-creator",
    CREATOR,
  ];
  /** An endpoint nothing listens on: every refusal below comes before any request. */
  const NOWHERE = ["--rpc-url", "http://127.0.0.1:9/"];

  it("needs the destination's endpoint", async () => {
    const run = await sauce("fill", file("bridge.sauce.ts", INTENT), ...FLAGS);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /missing --config <file> \(or --rpc-url <url>\): the endpoint of each intent's destination/,
    );
  });

  it("refuses a claimant that is neither 20 nor 32 bytes", async () => {
    const run = await sauce(
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
      "fill",
      file("none.sauce.ts", "require(chainId == 42161n);\n"),
      "--chain",
      "arbitrum",
      ...NOWHERE,
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/opens no intent: there is nothing for a solver to fill/);
    const two = await sauce(
      "fill",
      file(
        "two.sauce.ts",
        `${INTENT}Optimism(() => {\n  Token(0x0b2c639c533813f4aa9d7837caf62653d097ff85n).transfer(RECIPIENT, 5n);\n}).reward({ tokens: [{ token: USDC, amount: 7n }] });\n`,
      ),
      ...FLAGS,
      ...NOWHERE,
    );
    expect(two.code).toBe(2);
    expect(two.stderr).toMatch(/intents go to base and optimism: --rpc-url names one endpoint/);
  });

  it("refuses a source chain with no Portal to publish through", async () => {
    const run = await sauce(
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

  it("refuses a missing owner, and an owner that is not the chain's kind of address", async () => {
    expect((await sauce("pot", "--chain", "base")).stderr).toMatch(/missing --owner <address>/);
    expect((await sauce("pot", "--owner", OWNER)).stderr).toMatch(/missing --chain/);
    const svm = await sauce("pot", "--owner", OWNER, "--chain", "solana");
    expect(svm.code).toBe(2);
    expect(svm.stderr).toMatch(/is not a Solana address \(a base58 public key\)/);
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

  it("names a flag the command does not take, and why, instead of an unknown option", async () => {
    const program = file("split.sauce.ts", SPLIT);
    const cases: Array<[string[], RegExp]> = [
      [
        ["tx", program, "--chain", "base", "--owner", OWNER, "--keystore", "k.json"],
        /--keystore is not an option of sauce tx: tx signs nothing: it prints the transaction unsigned/,
      ],
      [
        ["simulate", program, "--chain", "solana", "--owner", OWNER, "--keypair", "id.json"],
        /--keypair is not an option of sauce simulate: on Solana, simulate runs the cook from --owner/,
      ],
      [
        ["compile", program, "--chain", "base", "--yes"],
        /--yes is not an option of sauce compile: compile has nothing to ask \(sauce run, sauce pot take it\)/,
      ],
      [
        ["globals", "--chain", "base", "--rpc-url", "http://x"],
        /globals reads nothing from a chain/,
      ],
      [["compile", program, "--chain", "base", "--nope"], /unknown option --nope/],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce(...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
    // `pot` takes --yes, which it has no use for: --deploy never asks.
    const pot = await sauce("pot", "--owner", OWNER, "--chain", "base", "--yes");
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
});

describe("sauce price", () => {
  const WETH_BASE = "0x4200000000000000000000000000000000000006";

  it("prints the pool's sqrtPriceX96 for the chain's token order, and each direction's floor", async () => {
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
      base: { symbol: "WETH", address: WETH_BASE, decimals: 18 },
      quote: {
        symbol: "USDC",
        address: getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
        decimals: 6,
      },
      token0: "WETH",
      token1: "USDC",
      sqrtPriceX96: sqrt.toString(),
      // Selling WETH: 2700e6 USDC units per 1e18 WETH units, times 1e18.
      sell: {
        tokenIn: "WETH",
        tokenOut: "USDC",
        zeroForOne: true,
        sqrtPriceLimitX96: sqrt.toString(),
        limit: "floor",
        minAvgPrice: "2700000000",
      },
      // Buying WETH: 1e18 / 2700e6 WETH units per USDC unit, times 1e18, rounded up.
      buy: {
        tokenIn: "USDC",
        tokenOut: "WETH",
        zeroForOne: false,
        sqrtPriceLimitX96: sqrt.toString(),
        limit: "ceiling",
        minAvgPrice: ((10n ** 36n + 2700n * 10n ** 6n - 1n) / (2700n * 10n ** 6n)).toString(),
      },
    });
    const text = await sauce("price", "--chain", "base", "WETH", "USDC", "2700");
    expect(text.stdout).toContain(`sqrtPriceX96  ${sqrt}`);
    expect(text.stdout).toMatch(/minAvgPrice +2700000000 +USDC units per WETH unit/);
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
      [["--chain", "base", "WETH", "USDC", "1", "--sqrt-price-x96", "1"], /not both/],
      [["--chain", "base", "WETH", "USDC", "1e3"], /'1e3' is not a price/],
      [["--chain", "base", "WETH", "USDC:18", "1"], /USDC has 6 decimals, not 18/],
      [["--chain", "base", "WETH", "WETH", "1"], /WETH is both/],
      [["--chain", "base", "WETH", "USDC", "--sqrt-price-x96", "5"], /outside the range/],
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
    ].flatMap((module) => Object.keys(module));
    expect(cli.length).toBeGreaterThan(0);
    const routes = root.routes as Record<string, unknown>;
    expect(cli.filter((name) => name in root || name in routes)).toEqual([]);
  });

  it("has a chain to name for every canonical slug", () => {
    expect(requireChain("solana").kind).toBe("svm");
  });
});

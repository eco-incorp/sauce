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
import { castSend } from "../src/cli/commands.js";
import { failureReason } from "../src/cli/solana.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  v12DeployedAddresses,
  v12EngineAddress,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/kitchen.js";
import {
  potSalt,
  SAUCE_INTENT_POT_SALT,
  v12GateKitchen,
  v12PredictPot,
} from "../src/deployments/pot.js";
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
    expect(run.stderr).toMatch(/unknown command 'deploy'\. Commands: compile, simulate, run, /);
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
    // A bare body cannot carry an import, since it is wrapped in `main`: say what to write instead.
    const bare = file(
      "bare.sauce.ts",
      'import { fee } from "./lib/fee.js";\nrequire(fee(1n) > 0n);\n',
    );
    expect((await sauce("compile", bare, "--chain", "base")).stderr).toMatch(
      /hint: a file that imports must declare function main\(\)/,
    );
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
      kitchen: v12GateKitchen(),
      to: v12GateKitchen(),
      data: v12Kitchen.encodeDeployPot(OWNER, salt),
      value: "0",
    });
    expect(run.stderr).toMatch(/Any account may send it/);
    const cast = await sauce("pot", "--owner", OWNER, "--chain", "base", "--format", "cast");
    expect(cast.stdout).toMatch(
      new RegExp(
        `^cast send ${v12GateKitchen()} 0x[0-9a-f]+ --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>\n$`,
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
    ].flatMap((module) => Object.keys(module));
    expect(cli.length).toBeGreaterThan(0);
    const routes = root.routes as Record<string, unknown>;
    expect(cli.filter((name) => name in root || name in routes)).toEqual([]);
  });

  it("has a chain to name for every canonical slug", () => {
    expect(requireChain("solana").kind).toBe("svm");
  });
});

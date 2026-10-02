/**
 * `cli/inputs.ts`: what a command's input means, taken as plain values — the rules the `sauce`
 * command and the MCP server's tools both apply, held here independently of either front end.
 * And `sauce mcp`'s own flag rules, which the CLI checks before it loads the server at all.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireChain } from "../src/chains/canonical.js";
import { potSalt, SAUCE_INTENT_POT_SALT } from "../src/deployments/pot.js";
import { UsageError } from "../src/cli/args.js";
import type { ProgramInput } from "../src/cli/commands.js";
import {
  assumedBalances,
  bindMainArguments,
  definesReach,
  fundingFor,
  potTarget,
  programChain,
} from "../src/cli/inputs.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const POT = "0x6666666666666666666666666666666666666666";
const base = requireChain("base");

describe("programChain", () => {
  it("takes the chain given, else the header's, else solana for svm alone", () => {
    expect(programChain({ chain: "8453" }, "p.sauce.ts", "").slug).toBe("base");
    expect(programChain({}, "p.sauce.ts", "// @chain arbitrum\nfoo();\n").slug).toBe("arbitrum");
    expect(programChain({ target: "svm" }, "p.sauce.ts", "").slug).toBe("solana");
    expect(programChain({}, "p.sauce.ts", "// @target svm\n").slug).toBe("solana");
    expect(programChain({}, "p.sauce.ts", "", base).slug).toBe("base");
  });

  it("refuses a missing chain, a target that disagrees, and a header given twice", () => {
    expect(() => programChain({}, "p.sauce.ts", "")).toThrow(/missing --chain/);
    expect(() => programChain({ chain: "base", target: "svm" }, "p.sauce.ts", "")).toThrow(
      /--target svm does not match base/,
    );
    expect(() => programChain({}, "p.sauce.ts", "// @chain base\n// @chain arbitrum\n")).toThrow(
      /gives @chain twice/,
    );
  });
});

describe("definesReach", () => {
  it("refuses a define a script's own top-level const would shadow, and only then", () => {
    expect(() =>
      definesReach("s.sauce.ts", "const AMOUNT = 5n;\nrequire(AMOUNT > 0n);\n", ["AMOUNT"]),
    ).toThrow(/--define AMOUNT would not reach s\.sauce\.ts/);
    // With main, a module-level const is what a define replaces.
    expect(() =>
      definesReach("m.sauce.ts", "const AMOUNT = 5n;\nfunction main() {}\n", ["AMOUNT"]),
    ).not.toThrow();
    // A name inside a string is not a declaration.
    expect(() =>
      definesReach("s.sauce.ts", 'require(true, "const AMOUNT");\n', ["AMOUNT"]),
    ).not.toThrow();
  });
});

describe("potTarget", () => {
  it("takes the Pot by address, or by owner and salt, the default salt zero", () => {
    expect(potTarget({ pot: POT })).toEqual({ pot: POT });
    expect(potTarget({ owner: OWNER })).toEqual({ owner: OWNER, salt: SAUCE_INTENT_POT_SALT });
    expect(potTarget({ owner: OWNER, salt: "vault" })).toMatchObject({ salt: potSalt("vault") });
    expect(potTarget({}, OWNER as `0x${string}`)).toMatchObject({ owner: OWNER });
  });

  it("refuses both, neither, and a salt beside a Pot named outright", () => {
    expect(() => potTarget({ pot: POT, owner: OWNER })).toThrow(/give --pot or --owner, not both/);
    expect(() => potTarget({})).toThrow(/missing --pot <address> or --owner <address>/);
    expect(() => potTarget({ pot: POT, salt: "x" })).toThrow(
      /--salt and --salt-hex go with --owner/,
    );
    expect(() => potTarget({ owner: OWNER, salt: "x", saltHex: `0x${"00".repeat(32)}` })).toThrow(
      /give --salt or --salt-hex, not both/,
    );
  });
});

describe("fundingFor and assumedBalances", () => {
  const given = {
    chain: base,
    rpcUrl: "http://127.0.0.1:9",
    sweep: false,
    send: false,
    // A rehearsal sends nothing, so no one is asked to approve anything.
    approver: { auto: false, canAsk: false, approve: async () => undefined },
  };

  it("is nothing without funding, and refuses a mode or a sweep with nothing to fund", () => {
    expect(fundingFor({ ...given, fund: [] })).toBeUndefined();
    expect(() => fundingFor({ ...given, fund: [], mode: "permit" })).toThrow(
      /--fund-mode says how/,
    );
    expect(() => fundingFor({ ...given, fund: [], sweep: true })).toThrow(/--sweep returns/);
  });

  it("refuses a token named twice, an unknown mode, and funding on Solana, before anything is sent", () => {
    expect(() => fundingFor({ ...given, fund: ["USDC:1", "USDC:2"] })).toThrow(
      /--fund names USDC twice/,
    );
    expect(() => fundingFor({ ...given, fund: ["USDC:1"], mode: "gift" })).toThrow(
      /--fund-mode: 'gift' is not/,
    );
    expect(() => fundingFor({ ...given, chain: requireChain("solana"), fund: ["USDC:1"] })).toThrow(
      /--fund is for EVM chains/,
    );
    expect(typeof fundingFor({ ...given, fund: ["USDC:1", "ETH:0.1"] })).toBe("function");
  });

  it("reads assumed balances once each", () => {
    expect(assumedBalances(["USDC:2", "ETH:1"], base).map((request) => request.label)).toEqual([
      "USDC",
      "ETH",
    ]);
    expect(() => assumedBalances(["USDC:2", "USDC:3"], base)).toThrow(
      /--assume-balance names USDC twice/,
    );
    expect(() => assumedBalances(["USDC"], base)).toThrow(UsageError);
  });
});

describe("sauce mcp, before the server loads", () => {
  async function sauce(...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  it("is listed, prints its help, and checks which flags go with which mode", async () => {
    expect((await sauce("--help")).stdout).toMatch(/\n {2}mcp +Serve the commands and the agent/);
    const help = await sauce("mcp", "--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/npx -y @eco-incorp\/sauce mcp --http 3000 --config/);
    expect(help.stdout).toMatch(/--wallets \[<dir>\] +Over stdio: sign with the wallets/);
    for (const [argv, message] of [
      [["mcp", "--agent", "claude"], /--agent goes with sauce mcp setup/],
      [["mcp", "setup", "--http", "0"], /--http is for serving, not setup/],
      [["mcp", "setup", "--allow-private-rpc"], /--allow-private-rpc is for serving/],
      [["mcp", "serve"], /unexpected argument serve/],
      // Wallets are stdio's alone, with a password source that is not a prompt.
      [["mcp", "--http", "0", "--wallets", "--password-env", "X"], /--wallets is for stdio/],
      [["mcp", "--wallets"], /--wallets needs its password source/],
      [["mcp", "--password-file", "p"], /--password-file goes with --wallets/],
    ] as const) {
      const run = await sauce(...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
  });
});

describe("bindMainArguments: main's arguments, bound into the intents a wallet publishes", () => {
  const RECIPIENT = "0x6666666666666666666666666666666666666666";
  const BRIDGE = [
    "function main(amount: Uint256, reward: Uint256, recipient: Address, sweep: bool) {",
    "  Base(() => {",
    "    USDC.transfer(recipient, amount);",
    "  }).reward({ tokens: [{ token: USDC, amount: reward }] });",
    "}",
    "",
  ].join("\n");
  const input = (text: string, defines: ProgramInput["defines"] = {}): ProgramInput => ({
    file: "bridge.sauce.ts",
    text,
    chain: requireChain("ethereum"),
    defines,
    compactArgs: false,
    intents: {},
  });
  const args = (...values: string[]) => ({ from: "--args" as const, values });

  it("blanks main's parameter list in place and makes each argument its name's value", () => {
    const bound = bindMainArguments(input(BRIDGE), args("1000000", "1010000", RECIPIENT, "true"));
    expect(bound.defines).toEqual({
      amount: 1_000_000n,
      reward: 1_010_000n,
      recipient: BigInt(RECIPIENT),
      sweep: true,
    });
    expect(bound.addressDefines).toEqual(["recipient"]);
    // Same length, same lines: the compiler's positions are still the file's.
    expect(bound.text).toHaveLength(BRIDGE.length);
    const list = "amount: Uint256, reward: Uint256, recipient: Address, sweep: bool";
    expect(bound.text.split("\n")[0]).toBe(`function main(${" ".repeat(list.length)}) {`);
    expect(bound.text.split("\n").slice(1)).toEqual(BRIDGE.split("\n").slice(1));
  });

  it("takes --args-json values as they are", () => {
    const bound = bindMainArguments(input(BRIDGE), {
      from: "--args-json",
      values: [1_000_000, "1010000", RECIPIENT, false],
    });
    expect(bound.defines).toMatchObject({ amount: 1_000_000n, reward: 1_010_000n, sweep: false });
  });

  it("leaves a program whose main takes nothing as it is, and asks for the ones it takes", () => {
    const fixed = input("Base(() => { USDC.transfer(0x1n, 1n); }).reward({ nativeAmount: 1n });");
    expect(bindMainArguments(fixed, undefined)).toBe(fixed);
    expect(() => bindMainArguments(input(BRIDGE), undefined)).toThrow(
      /main\(amount: Uint256, reward: Uint256, recipient: Address, sweep: bool\) takes 4 arguments: pass them after --args/,
    );
  });

  it("refuses arguments for a file with no parameters, a wrong count, and a wrong value", () => {
    expect(() => bindMainArguments(input("function main() {}"), args("1"))).toThrow(
      /declares no `main` with parameters/,
    );
    expect(() => bindMainArguments(input(BRIDGE), args("1", "2"))).toThrow(
      /takes 4 arguments, got 2/,
    );
    expect(() =>
      bindMainArguments(input(BRIDGE), args("1", "2", "not an address", "true")),
    ).toThrow(/argument 3 \(recipient: Address\).*is not an address/);
  });

  it("refuses a parameter no one word holds, and a --define of a parameter's name", () => {
    const list = input("function main(path: Address[]) { }");
    expect(() => bindMainArguments(list, args('["0x1"]'))).toThrow(
      /argument 1 \(path: Address\[\]\): a wallet publishes .*\(sauce run\)/,
    );
    expect(() =>
      bindMainArguments(
        input(BRIDGE, { amount: 5n }),
        args("1000000", "1010000", RECIPIENT, "true"),
      ),
    ).toThrow(/amount is main's parameter, given by --args; it cannot also be a --define/);
  });

  it("publishes the intent the same program would with each value written in", async () => {
    const work = mkdtempSync(join(tmpdir(), "sauce-bind-"));
    try {
      const withParams = join(work, "params.sauce.ts");
      writeFileSync(withParams, BRIDGE);
      const literal = join(work, "literal.sauce.ts");
      writeFileSync(
        literal,
        BRIDGE.replace(/main\([^)]*\)/, "main()")
          .replace("recipient, amount", `${RECIPIENT}n, 1000000n`)
          .replace("amount: reward", "amount: 1010000n"),
      );
      const publish = async (file: string, ...extra: string[]) => {
        let stdout = "";
        const io: CliIo = {
          ...nodeIo(),
          stdout: (text) => void (stdout += text),
          stderr: () => {},
        };
        const code = await runCli(
          [
            ...["intent", "publish", file, "--chain", "ethereum", "--format", "json"],
            ...["--from", OWNER, "--intent-deadline", "2000000000", "--intent-creator", OWNER],
            ...extra,
          ],
          io,
        );
        expect(code).toBe(0);
        return (JSON.parse(stdout) as { intents: Array<{ intentHash: string }> }).intents;
      };
      const viaArgs = await publish(withParams, "--args", "1000000", "1010000", RECIPIENT, "true");
      expect(viaArgs).toHaveLength(1);
      expect(viaArgs).toEqual(await publish(literal));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

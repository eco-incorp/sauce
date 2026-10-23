/**
 * `cli/inputs.ts`: what a command's input means, taken as plain values — the rules the `sauce`
 * command and the MCP server's tools both apply, held here independently of either front end.
 * And `sauce mcp`'s own flag rules, which the CLI checks before it loads the server at all.
 */
import { requireChain } from "../src/chains/canonical.js";
import { DEFAULT_POT_SALT, potSalt } from "../src/deployments/pot.js";
import { UsageError } from "../src/cli/args.js";
import {
  assumedBalances,
  definesReach,
  fundingFor,
  potTarget,
  programChain,
  potOwner,
} from "../src/cli/inputs.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const POT = "0x6666666666666666666666666666666666666666";
const base = requireChain("base");

describe("potOwner", () => {
  it("takes a Solana owner in base58 or as its 32 bytes of hex, with the chain or without", () => {
    const solana = requireChain("solana");
    const owner = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const hex = "0x7e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2";
    for (const chain of [solana, undefined]) {
      expect(potOwner(chain, owner)).toBe(owner);
      expect(potOwner(chain, hex)).toBe(owner);
    }
    // 20 bytes of hex, with no chain, are an EVM address.
    expect(potOwner(undefined, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8")).toBe(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
  });
});

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
    expect(potTarget({ owner: OWNER })).toEqual({ owner: OWNER, salt: DEFAULT_POT_SALT });
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
    expect(help.stdout).toMatch(/\n {2}sauce mcp --http 3000\n/);
    expect(help.stdout).toMatch(/--wallets \[<dir>\] +Over stdio: the wallet directory its wallet/);
    expect(help.stdout).toMatch(/--no-wallets +Over stdio: serve no wallet tools; nothing signs/);
    // How each agent adds it, in `sauce mcp --help` and `sauce mcp setup --help` alike.
    for (const text of [help.stdout, (await sauce("mcp", "setup", "--help")).stdout]) {
      expect(text).toContain("claude mcp add sauce -- sauce mcp ");
      expect(text).toContain("codex mcp add sauce -- sauce mcp ");
      expect(text).toContain("gemini mcp add sauce sauce mcp ");
      expect(text).toContain('"sauce": { "command": "sauce", "args": ["mcp"] }');
    }
    for (const [argv, message] of [
      [["mcp", "--agent", "claude"], /--agent goes with sauce mcp setup/],
      [["mcp", "setup", "--http", "0"], /--http is for serving, not setup/],
      [["mcp", "setup", "--allow-private-rpc"], /--allow-private-rpc is for serving/],
      [["mcp", "serve"], /unexpected argument serve/],
      // Wallets are stdio's alone, served by default; a password source given is read at start.
      [["mcp", "--http", "0", "--wallets", "--password-env", "X"], /--wallets is for stdio/],
      [["mcp", "--http", "0", "--password-env", "X"], /--password-env is for stdio/],
      [["mcp", "--no-wallets", "--wallets", "d"], /--wallets goes with wallets, not --no-wallets/],
      [["mcp", "--no-wallets", "--password-env", "X"], /--password-env goes with wallets/],
      [["mcp", "setup", "--no-wallets"], /--no-wallets is for serving, not setup/],
      [["mcp", "--password-env", "SAUCE_TEST_UNSET_X"], /--password-env SAUCE_TEST_UNSET_X: the/],
    ] as const) {
      const run = await sauce(...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
  });
});

/**
 * `kyberSwap` and `ecoSwap` through the `sauce` command, in-process (`runCli`): where each asks for
 * its route (`--swap-api`, the `--config` file's `swapApis`, the built-in public one), for which Pot
 * (`--owner`/`--pot`, the cook's), and what `--offline` and a missing service refuse. The services
 * are `swap-stub.ts`'s, as a `fetch`: nothing reaches a network.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { v12PredictPot } from "../src/deployments/pot.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { stubSwapFetch } from "./swap-stub.js";

/** anvil's first account: an owner whose Pot the routes are built for. */
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const POT = v12PredictPot(OWNER, `0x${"00".repeat(32)}`);
const KYBER = "https://kyber.test";
const ECO = "https://eco.test";
const ECO_PROGRAM = `0x${"5a".repeat(40)}` as const;

const BOTH = `function main(recipient: Address, minOut: Uint256) {
  let filled = true;
  try {
    const out = kyberSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  } catch {
    filled = false;
  }
  if (!filled) {
    const out = ecoSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  }
}`;
const ECO_ONLY = `function main(amount: Uint256): Uint256 {
  return ecoSwap(USDC, WETH, amount, 0);
}`;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sauce-cli-swap-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

/** The command, with the built-in KyberSwap API the executable gives, and the stub behind it. */
async function sauce(
  argv: string[],
  apis: { kyber?: string; eco?: string; jupiter?: string } = { kyber: KYBER },
) {
  let stdout = "";
  let stderr = "";
  const stub = stubSwapFetch({
    kyberQuotes: 372_000_000_000_000_000n,
    ecoProgram: () => ECO_PROGRAM,
  });
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    swapApis: { ...apis, fetch: stub.fetch },
  };

  return { code: await runCli(argv, io), stdout, stderr, asked: stub.asked };
}

describe("sauce compile with kyberSwap and ecoSwap", () => {
  it("asks KyberSwap's built-in API for the Pot --owner names, and eco-swap's --swap-api", async () => {
    const program = file("both.sauce.ts", BOTH);
    const run = await sauce([
      "compile",
      program,
      "--chain",
      "base",
      "--owner",
      OWNER,
      "--swap-api",
      `eco=${ECO}`,
      "--json",
    ]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const json = JSON.parse(run.stdout) as { bytecode: string; swaps: Record<string, unknown>[] };
    expect(json.swaps).toEqual([
      expect.objectContaining({
        function: "kyberSwap",
        amountIn: "1000000000",
        minOut: null,
        pot: POT,
        router: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
        quotedOut: "372000000000000000",
      }),
      expect.objectContaining({ function: "ecoSwap", pot: POT, programSize: 40 }),
    ]);
    expect(json.bytecode).toContain(ECO_PROGRAM.slice(2));
    expect(run.asked.map((url) => url.origin).sort()).toEqual([ECO, KYBER, KYBER]);
    const routes = run.asked.find((url) => url.pathname === "/base/api/v1/routes")!;
    expect(routes.searchParams.get("amountIn")).toBe("1000000000");
  });

  it("a --config file's swapApis, under --swap-api", async () => {
    const program = file("eco.sauce.ts", ECO_ONLY);
    const config = file(
      "sauce.config.json",
      JSON.stringify({ rpcUrls: {}, swapApis: { eco: "https://configured.test" } }),
    );
    const configured = await sauce(["compile", program, "--chain", "base", "--config", config]);
    expect(configured.code).toBe(0);
    expect(configured.asked.map((url) => url.origin)).toEqual(["https://configured.test"]);
    const flagged = await sauce([
      "compile",
      program,
      "--chain",
      "base",
      "--config",
      config,
      "--swap-api",
      `eco=${ECO}`,
    ]);
    expect(flagged.asked.map((url) => url.origin)).toEqual([ECO]);
  });

  it("refuses ecoSwap with no eco-swap API: it has no default", async () => {
    const run = await sauce(["compile", file("eco.sauce.ts", ECO_ONLY), "--chain", "base"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/ecoSwap asks eco-swap's API for its route, and none is given/);
    expect(run.stderr).toMatch(/--swap-api eco=<url>/);
    expect(run.asked).toEqual([]);
  });

  it("refuses a top-level kyberSwap with no Pot to build it for", async () => {
    const run = await sauce(["compile", file("both.sauce.ts", BOTH), "--chain", "base"], {
      kyber: KYBER,
      eco: ECO,
    });
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/kyberSwap's route is built for the Pot the program runs on/);
    expect(run.asked).toEqual([]);
  });

  it("refuses a program that needs a route with --offline, asking nothing", async () => {
    const run = await sauce(
      ["compile", file("both.sauce.ts", BOTH), "--chain", "base", "--owner", OWNER, "--offline"],
      { kyber: KYBER, eco: ECO },
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/--offline: .* calls kyberSwap and ecoSwap/);
    expect(run.asked).toEqual([]);
  });

  it("asks nothing for a program with no swap", async () => {
    const run = await sauce([
      "compile",
      file("plain.sauce.ts", "function main(to: Address) { USDC.transfer(to, 1); }"),
      "--chain",
      "base",
    ]);
    expect(run.code).toBe(0);
    expect(run.asked).toEqual([]);
  });
});

describe("sauce tx builds the route for the cook's Pot", () => {
  it("the Pot --owner derives, once for the whole command", async () => {
    const run = await sauce(
      [
        "tx",
        file("both.sauce.ts", BOTH),
        "--chain",
        "base",
        "--owner",
        OWNER,
        "--value",
        "0",
        "--args",
        OWNER,
        "1",
      ],
      { kyber: KYBER, eco: ECO },
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).to).toBe(POT);
    const builds = run.asked.filter((url) => url.pathname === "/base/api/v1/route/build");
    expect(builds).toHaveLength(1);
  });
});

describe("a file whose intent bodies swap is not rebuilt from the file", () => {
  // The body swaps on Base, in the destination's shared Pot; the program runs on Ethereum.
  const BODY = `function main(owner: Address) {
  Base.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(owner)
    .receive({ token: USDC, amount: 1000000 })
    .fee(0)
    .then(() => {
      const out = kyberSwap(USDC, WETH, 1000000, 1);
      WETH.transfer(owner, out);
    });
}`;

  it.each([
    ["inspect", ["inspect"]],
    ["intent fill", ["intent", "fill"]],
  ])("%s refuses it, naming the published record, and asks no service", async (_name, verb) => {
    const run = await sauce([
      ...verb,
      file("body.sauce.ts", BODY),
      "--chain",
      "ethereum",
      "--offline",
      "--args",
      OWNER,
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/an intent's body calls kyberSwap, whose route is fetched when/);
    expect(run.stderr).toMatch(/Name the intent by its published record instead: its hash/);
    expect(run.asked).toEqual([]);
  });

  it("inspect reads a file whose swaps are only its own: its intents do not carry them", async () => {
    const run = await sauce([
      "inspect",
      file(
        "top.sauce.ts",
        `function main(owner: Address) {
  const out = ecoSwap(USDC, WETH, 1000000, 0);
  Base.Portal.send({ token: WETH, amount: 1 })
    .refundee(owner)
    .receive({ token: USDC, amount: 1 })
    .then(() => {
      USDC.transfer(owner, 1);
    });
}`,
      ),
      "--chain",
      "ethereum",
      "--offline",
      "--args",
      OWNER,
    ]);
    expect(run.stderr).not.toMatch(/kyberSwap|ecoSwap/);
    expect(run.code).toBe(0);
    expect(run.asked).toEqual([]);
  });
});

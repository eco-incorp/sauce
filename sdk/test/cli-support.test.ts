/**
 * The release's chain gate (`src/cli/support.ts`) through the `sauce` command, in process: every
 * command that builds or sends a transaction is refused on a preview chain BEFORE any network call
 * — an endpoint that records each request it gets stays untouched — and names the supported chains
 * and the chain's request; compile and the reads still run there, and simulate is not gated (it
 * reaches its chain, where the released engine's absence stops it).
 */
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  chainSupportRequest,
  PreviewChainError,
  previewRefusal,
  requireSupported,
} from "../src/cli/support.js";
import { privateKeyToAccount } from "viem/accounts";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RECIPIENT = "0x6666666666666666666666666666666666666666";

/** An endpoint that answers the reads a rehearsal starts with, and counts every request. */
interface Recorder {
  readonly url: string;
  readonly methods: string[];
  readonly server: Server;
}

async function recorder(chainId: number): Promise<Recorder> {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const calls = [
        JSON.parse(body) as { id: number; method: string } | object[],
      ].flat() as Array<{
        id: number;
        method: string;
      }>;
      const answers = calls.map((call) => {
        methods.push(call.method);
        const result =
          call.method === "eth_chainId"
            ? `0x${chainId.toString(16)}`
            : call.method === "eth_getCode" || call.method === "eth_call"
              ? "0x"
              : call.method === "eth_blockNumber"
                ? "0x1"
                : undefined;

        return result === undefined
          ? { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not here" } }
          : { jsonrpc: "2.0", id: call.id, result };
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? answers : answers[0]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    methods,
    server,
  };
}

let work: string;
let recorders: Recorder[] = [];
const file = (name: string, text: string): string => {
  const path = join(work, name);
  writeFileSync(path, text);

  return path;
};
/** A recorder for each chain, and the `--config` file naming them. */
async function endpoints(...ids: number[]): Promise<{ config: string; recorded: () => string[] }> {
  const made = await Promise.all(ids.map((id) => recorder(id)));
  recorders.push(...made);
  const config = file(
    `config-${ids.join("-")}.json`,
    JSON.stringify({ rpcUrls: Object.fromEntries(made.map((r, i) => [String(ids[i]), r.url])) }),
  );

  return { config, recorded: () => made.flatMap((r) => r.methods) };
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-support-"));
});
afterEach(async () => {
  await Promise.all(
    recorders.map((r) => new Promise<void>((resolve) => r.server.close(() => resolve()))),
  );
  recorders = [];
  rmSync(work, { recursive: true, force: true });
});

async function sauce(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    canAsk: () => false,
    confirm: async () => undefined,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };
  const code = await runCli(argv, io);

  return { code, stdout, stderr };
}

/** Exits 1, refusing `slug` with the supported chains and that chain's request. */
function expectRefused(
  run: { code: number; stdout: string; stderr: string },
  slug: string,
  action?: RegExp,
): void {
  expect(run.stdout).toBe("");
  expect(run.code).toBe(1);
  const chain = requireChain(slug);
  expect(run.stderr).toContain(
    `is refused: it involves ${chain.slug} (${chain.name}, chain id ${chain.id}), a preview chain.`,
  );
  if (action !== undefined) expect(run.stderr).toMatch(action);
  expect(run.stderr).toContain(
    "only on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet.",
  );
  expect(run.stderr).toContain(chainSupportRequest(chain).newIssueUrl);
  expect(run.stderr).toContain(chainSupportRequest(chain).searchUrl);
}

const PAY = "function main() {\n  USDC.transfer(RECIPIENT, 1000n);\n}\n";

describe("the gate", () => {
  it("refuses only a preview chain, naming each one once with its request", () => {
    const [ethereum, base, arc, solana, arbitrum, optimism] = [
      "ethereum",
      "base",
      "arc",
      "solana",
      "arbitrum",
      "optimism",
    ].map((slug) => requireChain(slug));
    expect(previewRefusal("sending the cook", [ethereum!, base!, arc!, solana!])).toBeUndefined();
    expect(() => requireSupported("sending the cook", [base!])).not.toThrow();
    const refusal = previewRefusal("sending the cook", [base!, arbitrum!, optimism!, arbitrum!])!;
    expect(refusal.code).toBe("preview-chain");
    expect(refusal.action).toBe("sending the cook");
    expect(refusal.supportedChains).toEqual([
      { slug: "ethereum", id: 1, name: "Ethereum" },
      { slug: "base", id: 8453, name: "Base" },
      { slug: "arc", id: 5042, name: "Arc" },
      { slug: "solana", id: 1399811149, name: "Solana" },
      { slug: "arc-testnet", id: 5042002, name: "Arc Testnet" },
      { slug: "base-sepolia", id: 84532, name: "Base Sepolia" },
      { slug: "sepolia", id: 11155111, name: "Ethereum Sepolia" },
      { slug: "solana-devnet", id: 1399811150, name: "Solana Devnet" },
      { slug: "solana-testnet", id: 1399811151, name: "Solana Testnet" },
    ]);
    expect(refusal.previewChains.map((chain) => chain.slug)).toEqual(["arbitrum", "optimism"]);
    expect(refusal.previewChains[0]!.request).toEqual(chainSupportRequest("arbitrum"));
    expect(refusal.message).toMatch(
      /^sending the cook is refused: it involves arbitrum \(Arbitrum One, chain id 42161\) and optimism \(Optimism, chain id 10\), preview chains\./,
    );
    // The label is a write policy: simulation runs wherever the release is deployed, preview or not.
    expect(refusal.message).toContain("On a preview chain they build and send none.");
    expect(refusal.message).toContain(
      "simulate runs wherever the release is deployed on the chain",
    );
    expect(refusal.message).not.toMatch(/not deployed|does not run|cannot simulate/);
    expect(() => requireSupported("sending the cook", [optimism!])).toThrow(PreviewChainError);
  });
});

describe("refused on a preview chain, before any network call", () => {
  it("sauce tx and sauce run", async () => {
    const { config, recorded } = await endpoints(10);
    const pay = file("pay.sauce.ts", PAY);
    const owner = ["--owner", OWNER, "--define", `RECIPIENT=${RECIPIENT}`];
    expectRefused(
      await sauce("tx", pay, "--chain", "optimism", ...owner, "--value", "0"),
      "optimism",
    );
    expectRefused(
      await sauce("tx", pay, "--chain", "optimism", ...owner, "--config", config),
      "optimism",
      /^sauce tx: building the cook transaction is refused/,
    );
    expectRefused(
      await sauce(
        ...["run", pay, "--chain", "optimism", "--define", `RECIPIENT=${RECIPIENT}`],
        ...["--config", config, "--private-key", OWNER_KEY, "--auto-approve"],
      ),
      "optimism",
      /^sauce run: sending the cook is refused/,
    );
    expect(recorded()).toEqual([]);
  });

  it("a cook, by its own chain only", async () => {
    const pay = file("pay.sauce.ts", PAY);
    const flags = ["--owner", OWNER, "--define", `RECIPIENT=${RECIPIENT}`, "--value", "0"];
    expectRefused(await sauce("tx", pay, "--chain", "arbitrum", ...flags), "arbitrum");
    const base = await sauce("tx", pay, "--chain", "base", ...flags);
    expect(base.stderr).not.toMatch(/is refused/);
    expect(base.code).toBe(0);
    expect(JSON.parse(base.stdout)).toMatchObject({ chainId: 8453 });
  });

  it("builds a cook on each EVM testnet the release is deployed on", async () => {
    const pay = file("pay.sauce.ts", PAY);
    const flags = ["--owner", OWNER, "--define", `RECIPIENT=${RECIPIENT}`, "--value", "0"];
    for (const [slug, chainId] of [
      ["arc-testnet", 5042002],
      ["base-sepolia", 84532],
      ["sepolia", 11155111],
    ] as const) {
      const run = await sauce("tx", pay, "--chain", slug, ...flags);
      expect([slug, run.stderr]).not.toEqual([slug, expect.stringMatching(/is refused/)]);
      expect([slug, run.code]).toEqual([slug, 0]);
      expect(JSON.parse(run.stdout)).toMatchObject({ chainId });
    }
  });

  it("sauce pot --deploy, and a pot's deployment as a cast line", async () => {
    const { config, recorded } = await endpoints(42161);
    expectRefused(
      await sauce(
        ...["pot", "--deploy", "--chain", "arbitrum", "--config", config],
        ...["--private-key", OWNER_KEY],
      ),
      "arbitrum",
      /^sauce pot: deploying a Pot is refused/,
    );
    expectRefused(
      await sauce("pot", "--chain", "arbitrum", "--owner", OWNER, "--format", "cast"),
      "arbitrum",
    );
    expect(recorded()).toEqual([]);
  });

  it("sauce send, by the chain each transaction is signed for", async () => {
    const { config, recorded } = await endpoints(10);
    const signed = await privateKeyToAccount(OWNER_KEY).signTransaction({
      chainId: 10,
      type: "eip1559",
      to: RECIPIENT,
      value: 0n,
      nonce: 0,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });
    expectRefused(
      await sauce("send", signed, "--config", config),
      "optimism",
      /^sauce send: sending is refused/,
    );
    expect(recorded()).toEqual([]);
  });
});

describe("still runs on a preview chain", () => {
  it("compiles, and predicts a Pot without its deployment", async () => {
    const compiled = await sauce(
      ...["compile", file("pay.sauce.ts", PAY), "--chain", "optimism"],
      ...["--define", `RECIPIENT=${RECIPIENT}`, "--json"],
    );
    expect(compiled.code).toBe(0);
    expect(JSON.parse(compiled.stdout)).toMatchObject({ chain: "optimism" });

    const pot = await sauce("pot", "--chain", "arbitrum", "--owner", OWNER);
    expect(pot.code).toBe(0);
    const json = JSON.parse(pot.stdout) as Record<string, unknown>;
    expect(json).toMatchObject({
      chainId: 42161,
      owner: OWNER,
      refused: { code: "preview-chain" },
    });
    expect(json.pot).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(json).not.toHaveProperty("to");
    expect(json).not.toHaveProperty("data");
    expect(pot.stderr).toContain("building the Pot's deployment is refused");
  });

  it("reads: a Pot's status, through its endpoint", async () => {
    const { config, recorded } = await endpoints(42161);
    const pot = await sauce("pot", "--chain", "arbitrum", "--owner", OWNER, "--config", config);
    expect(pot.code).toBe(0);
    expect(JSON.parse(pot.stdout)).toMatchObject({ deployment: { pot: { deployed: false } } });
    expect(recorded()).toContain("eth_getCode");
  });

  it("does not gate simulate: the rehearsal reaches its chain", async () => {
    const { config, recorded } = await endpoints(10);
    const simulated = await sauce(
      ...["simulate", file("pay.sauce.ts", PAY), "--chain", "optimism", "--owner", OWNER],
      ...["--define", `RECIPIENT=${RECIPIENT}`, "--config", config],
    );
    expect(simulated.stderr).not.toMatch(/is refused/);
    expect(recorded().length).toBeGreaterThan(0);
  });
});

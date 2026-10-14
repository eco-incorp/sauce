/**
 * The release's chain gate (`src/cli/support.ts`) through the `sauce` command, in process: every
 * command that builds or sends a transaction is refused on a preview chain BEFORE any network call
 * — an endpoint that records each request it gets stays untouched — and names the supported chains
 * and the chain's request; compile, simulate, the dry runs and the reads still run there.
 */
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireChain } from "../src/chains/canonical.js";
import { intentRecord } from "../src/cli/lifecycle.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { IntentStore } from "../src/cli/store.js";
import {
  chainSupportRequest,
  PreviewChainError,
  previewRefusal,
  requireSupported,
} from "../src/cli/support.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { assembleIntent } from "../src/routes/intent.js";
import { privateKeyToAccount } from "viem/accounts";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

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
let store: string;
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
  store = join(work, "store");
  mkdirSync(store);
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
    storeDir: store,
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
  expect(run.stderr).toContain("only on Ethereum, Base and Solana");
  expect(run.stderr).toContain(chainSupportRequest(chain).newIssueUrl);
  expect(run.stderr).toContain(chainSupportRequest(chain).searchUrl);
}

const PAY = "function main() {\n  USDC.transfer(RECIPIENT, 1000n);\n}\n";
/** An intent from `source` to `destination` built by hand, `USDC.transfer` its route's one call,
 *  saved in the store: what every lifecycle step names by its hash. */
function stored(source: string, destination: string): `0x${string}` {
  const from = requireChain(source);
  const to = requireChain(destination);
  const usdc = (chain: typeof from) =>
    `0x${registryTokenAddress(chain, "USDC")!.toString(16).padStart(40, "0")}` as `0x${string}`;
  const intent = assembleIntent(
    from,
    to,
    {
      deadline: 2_000_000_000n,
      portal: ecoRoutesPortal(to.slug),
      tokens: [{ token: usdc(to), amount: 5n }],
      calls: [
        {
          target: usdc(to),
          data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${5n.toString(16).padStart(64, "0")}`,
          value: 0n,
        },
      ],
    },
    {
      deadline: 2_000_000_000n,
      creator: CREATOR,
      prover: ecoRoutesProver(from.slug, to.slug),
      tokens: [{ token: usdc(from), amount: 7n }],
    },
  );
  const record = intentRecord(intent, { sourcePortal: ecoRoutesPortal(from.slug) });
  new IntentStore(store).save(record);

  return record.intentHash;
}

describe("the gate", () => {
  it("refuses only a preview chain, naming each one once with its request", () => {
    const [ethereum, base, solana, arbitrum, optimism] = [
      "ethereum",
      "base",
      "solana",
      "arbitrum",
      "optimism",
    ].map((slug) => requireChain(slug));
    expect(previewRefusal("sending the cook", [ethereum!, base!, solana!])).toBeUndefined();
    expect(() => requireSupported("sending the cook", [base!])).not.toThrow();
    const refusal = previewRefusal("sending the cook", [base!, arbitrum!, optimism!, arbitrum!])!;
    expect(refusal.code).toBe("preview-chain");
    expect(refusal.action).toBe("sending the cook");
    expect(refusal.supportedChains).toEqual([
      { slug: "ethereum", id: 1, name: "Ethereum" },
      { slug: "base", id: 8453, name: "Base" },
      { slug: "solana", id: 1399811149, name: "Solana" },
    ]);
    expect(refusal.previewChains.map((chain) => chain.slug)).toEqual(["arbitrum", "optimism"]);
    expect(refusal.previewChains[0]!.request).toEqual(chainSupportRequest("arbitrum"));
    expect(refusal.message).toMatch(
      /^sending the cook is refused: it involves arbitrum \(Arbitrum One, chain id 42161\) and optimism \(Optimism, chain id 10\), preview chains\./,
    );
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

  it("sauce intent fill --send, prove and cancel by the destination; claim and refund by the source", async () => {
    const { config, recorded } = await endpoints(8453, 42161);
    const toArbitrum = stored("base", "arbitrum");
    const toBase = stored("arbitrum", "base");
    const base = ["--config", config];
    const arbitrum = ["--config", config];
    expectRefused(
      await sauce(...["intent", "fill", toArbitrum, ...base, "--send", "--private-key", OWNER_KEY]),
      "arbitrum",
      /^sauce intent fill: sending a fill is refused/,
    );
    expectRefused(
      await sauce("intent", "prove", toArbitrum, ...base),
      "arbitrum",
      /^sauce intent prove: proving/,
    );
    expectRefused(await sauce("intent", "cancel", toArbitrum, ...base), "arbitrum");
    expectRefused(
      await sauce("intent", "claim", toBase, ...arbitrum),
      "arbitrum",
      /^sauce intent claim: claiming/,
    );
    expectRefused(await sauce("intent", "refund", toBase, ...arbitrum), "arbitrum");
    // The other side of each intent is a supported chain, so the same steps go ahead (and fail
    // on the recorder's empty chain, which is past the gate).
    expect((await sauce("intent", "claim", toArbitrum, ...base)).stderr).not.toMatch(/refused/);
    expect(recorded()).not.toEqual([]);
  });

  it("an intent the store holds, before its endpoint is asked which chain it serves", async () => {
    const { url, methods } = await recorder(42161).then((made) => {
      recorders.push(made);

      return made;
    });
    const hash = stored("base", "arbitrum");
    expectRefused(
      await sauce("intent", "prove", hash, "--rpc-url", url, "--private-key", OWNER_KEY),
      "arbitrum",
    );
    expectRefused(
      await sauce("intent", "fill", hash, "--rpc-url", url, "--send", "--private-key", OWNER_KEY),
      "arbitrum",
    );
    expect(methods).toEqual([]);
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

  it("simulates, and rehearses a fill: each reaches its chain", async () => {
    const { config, recorded } = await endpoints(10, 8453, 42161);
    const simulated = await sauce(
      ...["simulate", file("pay.sauce.ts", PAY), "--chain", "optimism", "--owner", OWNER],
      ...["--define", `RECIPIENT=${RECIPIENT}`, "--config", config],
    );
    expect(simulated.stderr).not.toMatch(/is refused/);
    expect(recorded().length).toBeGreaterThan(0);

    const fill = await sauce("intent", "fill", stored("base", "arbitrum"), "--config", config);
    expect(fill.stderr).not.toMatch(/is refused/);
    expect(recorded()).toEqual(expect.arrayContaining(["eth_chainId"]));
  });
});

/**
 * What the `sauce` command's chain suites (`cli.e2e.test.ts`, `cli-funding.e2e.test.ts`) share: the
 * command run in process, and local anvils running the released gated stack (`evm/gated-engine.ts`,
 * deployed from the pinned creation code) with the engine at the address the SDK records, so the
 * CLI runs with no override.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  numberToHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type WalletClient,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesVaultImplementationOf,
} from "../src/protocols/eco-routes/lookup.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import * as gated from "./evm/gated-engine.js";

export const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
/** jest's `describe`, as far as `describeEvm` uses it — typed here, and read when called rather
 *  than when this module loads, so a suite on another runner (`mcp/test`) can import the harness. */
interface Describe {
  (name: string, fn: () => void): void;
  readonly skip: (name: string, fn: () => void) => void;
}
const jestDescribe = (): Describe => (globalThis as unknown as { describe: Describe }).describe;
/** `describe`, or `describe.skip` without the engine. */
export const describeEvm = (name: string, fn: () => void): void =>
  (RUNTIME_HEX_PATH ? jestDescribe() : jestDescribe().skip)(name, fn);
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** The token fixtures `std/token`'s suites run, as `{ abi, creationCode }`. */
export const fixture = (name: string, dir = join(HERE, "std/token/fixtures")): Hex =>
  (JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as { creationCode: Hex })
    .creationCode;
export const CLI_FIXTURES = join(HERE, "fixtures/cli");

/** Anvil's first two dev accounts: the Kitchen's owner, and the Pot's. Public keys, local only. */
export const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
export const OWNER = privateKeyToAccount(OWNER_KEY);
/** Anvil's fifth dev account, for a Pot of its own. */
export const OTHER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

/** Non-zero, so the fee `--rpc-url` reads is one a cook provably pays. */
export const FEE = 1_234n;

export const WORKER = Number(process.env.JEST_WORKER_ID ?? "1") % 50;

export const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The intent store the suites' commands write to: never the real `~/.sauce`. */
export const TEST_STORE = mkdtempSync(join(tmpdir(), "sauce-store-"));

/** Runs the command in process with `overrides` on the real io — a scripted answer to a prompt. */
export async function sauceWith(overrides: Partial<CliIo>, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    storeDir: TEST_STORE,
    ...overrides,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

export const sauce = (...argv: string[]): Promise<Run> => sauceWith({}, ...argv);

export const jsonOf = (run: Run): Record<string, unknown> => {
  // `--json` puts a failure on stdout, so both streams are shown.
  if (run.code !== 0) throw new Error(`sauce exited ${run.code}: ${run.stderr}${run.stdout}`);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

/** One anvil standing in for `chain`, with the released gated stack on it. */
export interface LocalChain {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  readonly publicClient: PublicClient;
  readonly deployer: WalletClient;
  readonly owner: WalletClient;
  readonly testClient: TestClient;
  /** Sends `data` to `to` from `from`, waits for it to succeed, and returns its hash. */
  send(from: WalletClient, to: Address, data: Hex, value?: bigint): Promise<Hex>;
  /** Deploys `creationCode` and moves its runtime to `at` (a registry token address), or leaves it. */
  plant(creationCode: Hex, at?: Address): Promise<Address>;
  mint(token: Address, to: Address, amount: bigint): Promise<void>;
  balanceOf(token: Address, holder: Address): Promise<bigint>;
  stop(): Promise<void>;
}

export async function startChain(slug: string, port: number): Promise<LocalChain> {
  const chain = requireChain(slug);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--port", String(port), "--chain-id", String(chain.id), "--silent"],
    { stdio: "ignore" },
  );
  // `connection: close`: pooled keep-alive sockets would outlive the suite.
  const transport = http(rpcUrl, { fetchOptions: { headers: { connection: "close" } } });
  const publicClient = createPublicClient({ transport });
  const testClient = createTestClient({ mode: "anvil", transport });
  const deployer = createWalletClient({ account: DEPLOYER, transport });
  const owner = createWalletClient({ account: OWNER, transport });
  for (const deadline = Date.now() + 20_000; ;) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil did not come up on ${rpcUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const send = async (from: WalletClient, to: Address, data: Hex, value = 0n): Promise<Hex> => {
    const hash = await from.sendTransaction({
      account: from.account!,
      chain: null,
      to,
      data,
      value,
    });
    const { status } = await publicClient.waitForTransactionReceipt({ hash });
    if (status !== "success") throw new Error(`a transaction to ${to} reverted`);

    return hash;
  };
  const plant = async (creationCode: Hex, at?: Address): Promise<Address> => {
    const hash = await deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: creationCode,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    if (at === undefined) return contractAddress!;
    const code = await publicClient.getCode({ address: contractAddress! });
    await testClient.setCode({ address: at, bytecode: code! });

    return at;
  };

  const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
  const stack = await gated.startGatedEngine(
    { publicClient, walletClient: deployer, testClient },
    DEPLOYER.address,
    creationCode,
  );
  // The CLI names the engine the SDK records. A harness that deploys it at that release address
  // needs nothing more; one that deploys it elsewhere moves it there.
  const released = getAddress(v12EngineAddress());
  if (getAddress(stack.engine) !== released) {
    const install = (gated as Record<string, unknown>).installEngineAt as
      ((clients: object, from: Address, to: Address) => Promise<void>) | undefined;
    if (install === undefined) throw new Error(`the harness put the engine at ${stack.engine}`);
    await install({ publicClient, testClient }, stack.engine, released);
  }
  await send(
    deployer,
    gated.gateAnchors().kitchen,
    encodeFunctionData({
      abi: parseAbi(["function setExecutionFee(uint256)"]),
      functionName: "setExecutionFee",
      args: [FEE],
    }),
  );

  return {
    chain,
    rpcUrl,
    publicClient,
    deployer,
    owner,
    testClient,
    send,
    plant,
    mint: async (token, to, amount) => {
      await send(
        deployer,
        token,
        encodeFunctionData({ abi: erc20, functionName: "mint", args: [to, amount] }),
      );
    },
    balanceOf: (token, holder) =>
      publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: "balanceOf",
        args: [holder],
      }),
    stop: async () => {
      if (anvil.exitCode !== null) return;
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    },
  };
}

/** The Pot's owner, as the Pot itself reports it. */
export const potOwner = (local: LocalChain, pot: Address): Promise<Address> =>
  local.publicClient.readContract({
    address: pot,
    abi: parseAbi(["function owner() view returns (address)"]),
    functionName: "owner",
  });

/** The registry's address for `symbol` on `chain`, as the program names it. */
export const registered = (chain: CanonicalChain, symbol: string): Address =>
  getAddress(numberToHex(registryTokenAddress(chain, symbol)!, { size: 20 }));

/**
 * The real eco-routes Portal (`evm/fixtures/Portal.json`, its own forge creation code) at the
 * address the SDK records for `local`'s chain, deployed there IN EFFECT: its Executor and its vault
 * implementation where a Portal deployed at that address would have created them. So a fill runs
 * the Portal's real `_fulfill`, and its vaults are the ones the SDK derives, with no override.
 *
 * THE PORTAL IS PUT IN PLACE, NOT DEPLOYED THERE. A Portal's address is its deployer's, and its
 * constructor CREATEs two contracts: the vault implementation (`ECO_ROUTES_VAULT_IMPLEMENTATION_NONCE`)
 * and the Executor (`ECO_ROUTES_EXECUTOR_NONCE`). The Portal holds both addresses as immutables (its
 * `executor`, and the implementation its vaults are clones of), and the two hold the Portal's (the
 * Executor's `onlyPortal` check). So this deploys the fixture wherever it lands, then copies all three
 * runtimes to the registry's Portal and the two addresses derived from it, with every copy of those
 * three addresses rewritten. Copied alone, the Portal would derive its vaults from the
 * implementation of the address it really landed at, which no deployed Portal does and the SDK does
 * not predict. Its other immutables are untouched: its chain id (anvil's, which `startChain` sets
 * to the chain's) and its EIP-712 cache, which recomputes the domain for an address that is not the
 * cached one.
 */
export async function placePortal(local: LocalChain): Promise<{
  readonly portal: Address;
  readonly executor: Address;
  readonly vaultImplementation: Address;
}> {
  const portal = getAddress(ecoRoutesPortal(local.chain.slug));
  const executor = getAddress(ecoRoutesExecutorOf(portal));
  const vaultImplementation = getAddress(ecoRoutesVaultImplementationOf(portal));
  const creation = (
    JSON.parse(readFileSync(join(HERE, "evm/fixtures/Portal.json"), "utf8")) as {
      creationCode: Hex;
    }
  ).creationCode;
  const deployed = await local.plant(
    `${creation}${encodeAbiParameters([{ type: "address" }], [zeroAddress]).slice(2)}` as Hex,
  );
  const moves = [
    [deployed, portal],
    [getAddress(ecoRoutesVaultImplementationOf(deployed)), vaultImplementation],
    [getAddress(ecoRoutesExecutorOf(deployed)), executor],
  ] as const;
  const relocated = (code: Hex): Hex =>
    moves.reduce(
      (text, [from, to]) => text.split(from.slice(2).toLowerCase()).join(to.slice(2).toLowerCase()),
      code.toLowerCase(),
    ) as Hex;
  for (const [from, to] of moves) {
    const code = await local.publicClient.getCode({ address: from });
    if (code === undefined) throw new Error(`the Portal's deployment left no contract at ${from}`);
    await local.testClient.setCode({ address: to, bytecode: relocated(code) });
  }
  const placed = await local.publicClient.readContract({
    address: portal,
    abi: PORTAL_EXECUTOR,
    functionName: "executor",
  });
  if (getAddress(placed) !== executor) {
    throw new Error(`the placed Portal's executor is ${placed}, not ${executor}`);
  }

  return { portal, executor, vaultImplementation };
}

const PORTAL_EXECUTOR = parseAbi(["function executor() view returns (address)"]);

/** Deploys the owner's Pot with the transaction `sauce pot` prints, returning its address. */
export async function deployPot(
  local: LocalChain,
  owner: Address = OWNER.address,
): Promise<Address> {
  const out = jsonOf(await sauce("pot", "--owner", owner, "--chain", local.chain.slug));
  // Anyone may send it: the deployer does, and the Pot is still the owner's.
  await local.send(local.deployer, out.to as Address, out.data as Hex);

  return out.pot as Address;
}

/**
 * An endpoint in front of `upstream` that lags behind the chain the way a load-balanced provider
 * can: after it has relayed a transaction, its next `stale` answers to `eth_getCode` are empty, as
 * from a node that has not seen the block yet. `served` counts the empty answers it gave.
 */
export async function laggingEndpoint(
  upstream: string,
  stale: number,
): Promise<{ readonly url: string; served(): number; stop(): Promise<void> }> {
  let owed = 0;
  let served = 0;
  // The block it lags at: the one before the transaction it last relayed.
  let behind = "latest";
  const forward = async (request: unknown): Promise<{ result?: unknown }> =>
    (await (
      await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: JSON.stringify(request),
      })
    ).json()) as { result?: unknown };
  const answer = async (request: {
    id: unknown;
    method: string;
    params?: unknown[];
  }): Promise<unknown> => {
    if (request.method === "eth_getCode" && owed > 0) {
      owed--;
      // The code as it was before that transaction: an older contract is there, a new one is not.
      const old = await forward({ ...request, params: [request.params?.[0], behind] });
      if (old.result === "0x") served++;

      return old;
    }
    if (request.method === "eth_sendRawTransaction") {
      const latest = await forward({ jsonrpc: "2.0", id: 0, method: "eth_blockNumber" });
      behind = latest.result as string;
      owed = stale;
    }

    return forward(request);
  };
  // The CLI's clients send one request at a time (viem's http transport does not batch unless
  // asked to), so a batch is refused rather than relayed unlagged.
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString()) as
        { id: unknown; method: string } | unknown[];
      if (Array.isArray(parsed)) {
        res.statusCode = 400;
        res.end("laggingEndpoint relays one request at a time");

        return;
      }
      void answer(parsed).then((out) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(out));
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    served: () => served,
    stop: async () => {
      server.closeAllConnections();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}

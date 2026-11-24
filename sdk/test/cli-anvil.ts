/**
 * What the `sauce` command's chain suites (`cli.e2e.test.ts`, `cli-funding.e2e.test.ts`) share: the
 * command run in process, and local anvils running the released gated stack (`evm/gated-engine.ts`,
 * deployed from the pinned creation code) with the engine at the address the SDK records, so the
 * CLI runs with no override.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { freePort, spawnAnvil } from "./anvil-process.js";
import * as gated from "./evm/gated-engine.js";
import { releaseArm } from "./release-arm.js";

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
/**
 * The password of `anvil-2.keystore.json`, in a file only its owner can read, as `--password-file`
 * requires: git checks the committed fixture out readable by all, so the suites pass a 0600 copy.
 */
export const KEYSTORE_PASSWORD_FILE = (() => {
  const path = join(mkdtempSync(join(tmpdir(), "sauce-password-")), "anvil-2.password");
  writeFileSync(path, readFileSync(join(CLI_FIXTURES, "anvil-2.password")), { mode: 0o600 });

  return path;
})();

/** Anvil's first two dev accounts: the Kitchen's owner, and the Pot's. Public keys, local only. */
export const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
export const OWNER = privateKeyToAccount(OWNER_KEY);
/** Anvil's fifth dev account, for a Pot of its own. */
export const OTHER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

/** Non-zero, so the fee `--rpc-url` reads is one a cook provably pays. */
export const FEE = 1_234n;

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

/** Runs the command in process with `overrides` on the real io — a scripted answer to a prompt. */
export async function sauceWith(overrides: Partial<CliIo>, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
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
  /**
   * Where `owner`'s Pot at `salt` (the CLI's default salt when left out) is on this chain: the
   * earlier release's Pot where the chain minted one for that owner at that salt (`legacy`), else
   * the installed release's, as `v12PredictPot` derives it.
   */
  potOf(owner: Address, salt?: Hex): Address;
  /**
   * The engine `pot` cooks on: the earlier release's for a Pot in `legacy.pots`, else the installed
   * release's.
   */
  engineOf(pot: Address): Address;
  /**
   * With `upgraded`: the earlier release as the chain ran it before the upgrade — its engine and
   * Router, the DEPLOYER's Pot at `POT_SALT`, and the Pot of each of `legacyOwners` at that salt,
   * all minted by that release's Kitchen (`evm/gated-engine.ts#startUpgradedChain`).
   */
  readonly legacy?: {
    readonly engine: Address;
    readonly router: Address;
    readonly pot: Address;
    readonly pots: Readonly<Record<Address, Address>>;
    /** From a chain that ran kitchen-evm 1.4.0: the DEPLOYER's fixed-Router and Shared Pot at the
     *  legacy salt, on the earlier Router for good. */
    readonly fixedPot?: Address;
    readonly sharedPot?: Address;
  };
  /** From `from: "1.4.0"`: the DEPLOYER's fixed-Router and Shared Pot minted after the Router
   *  switch, on the new Router. */
  readonly fixedPot?: Address;
  readonly sharedPot?: Address;
}

/** What `startChain` can stand up besides the release this SDK pins. */
export interface ChainOptions {
  /** The chain as the live ones are after kitchen-evm 1.4.0's rollout: the earlier release's stack
   *  with Pots minted on it, upgraded to the release this SDK pins (`startUpgradedChain`). */
  readonly upgraded?: boolean;
  /** With `upgraded`: owners whose earlier-release Pot is minted too, at `legacySalt`. */
  readonly legacyOwners?: readonly Address[];
  /** With `upgraded`: the salt the earlier-release Pots are minted at (`POT_SALT` when left out). */
  readonly legacySalt?: Hex;
  /** With `upgraded`: the earlier engine version the chain ran before the upgrade (`"1.3.0"` when
   *  left out; `"1.4.0"`: a chain whose Kitchen then switched to the new Router). */
  readonly from?: string;
}

/**
 * Starts an anvil standing in for `slug`, on a port the OS hands out (`anvil-process.ts`): a suite
 * never names one, so no two suites can share one.
 *
 * On a legacy arm (`SAUCE_TEST_EVM_ARM=1.3.0`, `release-arm.ts`) a call that does not say
 * `upgraded` stands up the chain as the live ones are: each of the CLI suites' fixed accounts (the
 * deployer, the owner and the "other" account) already owns an earlier-release Pot at the CLI's
 * default salt, so every command those accounts run online cooks on that Pot through the earlier
 * engine, and a fresh account still gets the installed release's Pot. The `sauce` command cannot
 * run on the `1.4.0` arm, whose stack has no engine at the address the command names.
 */
export async function startChain(slug: string, requested: ChainOptions = {}): Promise<LocalChain> {
  const arm = releaseArm("evm");
  if (arm === "1.4.0") {
    throw new Error(
      "the sauce command's suites run on the default and 1.3.0 arms (sdk/test/legacy-arm.json)",
    );
  }
  const options: ChainOptions =
    arm !== "default" && requested.upgraded === undefined
      ? {
          upgraded: true,
          legacyOwners: [DEPLOYER.address, OWNER.address, privateKeyToAccount(OTHER_KEY).address],
          legacySalt: DEFAULT_POT_SALT,
          from: arm,
        }
      : requested;
  const chain = requireChain(slug);
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = await spawnAnvil(port, ["--chain-id", String(chain.id)]);
  // `connection: close`: pooled keep-alive sockets would outlive the suite.
  const transport = http(rpcUrl, { fetchOptions: { headers: { connection: "close" } } });
  const publicClient = createPublicClient({ transport });
  const testClient = createTestClient({ mode: "anvil", transport });
  const deployer = createWalletClient({ account: DEPLOYER, transport });
  const owner = createWalletClient({ account: OWNER, transport });

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

  const stop = async (): Promise<void> => {
    if (anvil.exitCode !== null) return;
    const exited = once(anvil, "exit");
    anvil.kill();
    await exited;
  };
  let legacy: LocalChain["legacy"];
  let fixedPot: Address | undefined;
  let sharedPot: Address | undefined;
  const legacySalt = options.legacySalt ?? gated.POT_SALT;
  // A chain that cannot be set up is stopped, not left running for the rest of the worker's life.
  try {
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    const clients = { publicClient, walletClient: deployer, testClient };
    let stack: gated.GatedEngine;
    if (options.upgraded) {
      const upgraded = await gated.startUpgradedChain(clients, DEPLOYER.address, creationCode, {
        ...(options.legacyOwners === undefined ? {} : { legacyOwners: options.legacyOwners }),
        ...(options.legacySalt === undefined ? {} : { legacySalt: options.legacySalt }),
        ...(options.from === undefined ? {} : { from: options.from }),
      });
      legacy = upgraded.legacy;
      fixedPot = upgraded.fixedPot;
      sharedPot = upgraded.sharedPot;
      stack = upgraded;
    } else {
      stack = await gated.startGatedEngine(clients, DEPLOYER.address, creationCode);
    }
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
  } catch (error) {
    await stop();
    throw error;
  }

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
    stop,
    potOf: (who, salt = DEFAULT_POT_SALT) => {
      const minted =
        legacy !== undefined && salt.toLowerCase() === legacySalt.toLowerCase()
          ? legacy.pots[getAddress(who)]
          : undefined;

      return minted ?? getAddress(v12PredictPot(who, salt));
    },
    engineOf: (pot) => {
      const is = (one: Address | undefined): boolean =>
        one !== undefined && getAddress(one) === getAddress(pot);
      // A fixed-Router or Shared Pot minted before a Router switch runs on the earlier engine for
      // good; a dynamic Pot of such a chain runs on the installed one, as every Pot of a CREATE3
      // release does.
      if (is(legacy?.fixedPot) || is(legacy?.sharedPot)) return legacy!.engine;
      if (options.from === "1.4.0") return getAddress(v12EngineAddress());

      return legacy !== undefined && Object.values(legacy.pots).some((one) => is(one))
        ? legacy.engine
        : getAddress(v12EngineAddress());
    },
    ...(legacy === undefined ? {} : { legacy }),
    ...(fixedPot === undefined ? {} : { fixedPot }),
    ...(sharedPot === undefined ? {} : { sharedPot }),
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

/** A JSON-RPC request, as an endpoint in front of a chain reads it. */
export interface RpcRequest {
  readonly id: unknown;
  readonly method: string;
  readonly params?: unknown[];
}

/**
 * An endpoint in front of `upstream` that answers each request with `answer`, which relays requests
 * upstream (`forward`) as they are or changed. The CLI's clients send one request at a time (viem's
 * http transport does not batch unless asked to), so a batch is refused rather than answered unseen.
 */
async function relayEndpoint(
  upstream: string,
  answer: (
    request: RpcRequest,
    forward: (request: unknown) => Promise<{ result?: unknown }>,
  ) => Promise<unknown>,
): Promise<{ readonly url: string; stop(): Promise<void> }> {
  const forward = async (request: unknown): Promise<{ result?: unknown }> =>
    (await (
      await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: JSON.stringify(request),
      })
    ).json()) as { result?: unknown };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString()) as RpcRequest | unknown[];
      if (Array.isArray(parsed)) {
        res.statusCode = 400;
        res.end("this endpoint relays one request at a time");

        return;
      }
      void answer(parsed, forward).then((out) => {
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
    stop: async () => {
      server.closeAllConnections();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
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
  const relay = await relayEndpoint(upstream, async (request, forward) => {
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
  });

  return { url: relay.url, served: () => served, stop: relay.stop };
}

/**
 * An endpoint in front of `upstream` that runs `before` on each request ahead of relaying it: where
 * a test changes the chain at the moment a command reads or sends something.
 */
export const interceptingEndpoint = (
  upstream: string,
  before: (request: RpcRequest) => Promise<void>,
): Promise<{ readonly url: string; stop(): Promise<void> }> =>
  relayEndpoint(upstream, async (request, forward) => {
    await before(request);

    return forward(request);
  });

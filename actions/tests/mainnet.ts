/**
 * A mainnet — Ethereum, Base, Avalanche or OP Mainnet — frozen at one block, as a LOCAL anvil, so
 * the prod-like suites run against real deployed contracts with no RPC and no network at all. NOT a
 * `.test.ts`.
 *
 * REPLAY (every normal run). `tests/state/<suite>.genesis.json.gz` is a genesis file holding every
 * account and storage slot that suite read from its chain at the chain's pinned block (`CHAINS`).
 * Anvil boots from it (`--init`) at that block number, with its timestamp, on the chain's id, and
 * each later block is the chain's `blockInterval` seconds after the previous one — so nothing
 * depends on when the suite runs. Replay refuses to fork, and makes every non-loopback `fetch` throw:
 * a suite that quietly needs the network fails loudly instead of hanging or reading zeros.
 *
 * CAPTURE (only on request). `RECAPTURE_ANVIL_STATE=1` forks the chain at its pinned block instead,
 * runs the same suite, and on `stop()` rewrites the suite's genesis from what the fork read. The
 * RPC comes from one file only, `sdk/rpc.config.json` (gitignored; a JSON object of chain id -> URL,
 * the file `sdk/scripts/capture-registry-abi.mjs` reads) — never from the environment. It must serve
 * state at the pinned block. The fork reads through a local recording proxy, which forwards to the
 * RPC and keeps every account (`eth_getAccountInfo`, `eth_getBalance`, `eth_getCode`,
 * `eth_getTransactionCount`) and storage slot (`eth_getStorageAt`) it answered — values AT the pinned
 * block, before the suite changed anything. Neither of anvil's own mechanisms works: on a fork
 * `anvil_dumpState` holds only locally modified accounts, and Foundry's RPC cache loses whatever was
 * fetched after a snapshot as soon as the suite reverts it, which these suites do around every test.
 * Anvil's dev accounts are left out (a replaying anvil creates them), and in capture their live code
 * is cleared — the dev keys are public, and one carries an EIP-7702 delegation on Ethereum — so
 * capture and replay execute the same code. `stop()` checks the blob names no RPC before writing it.
 *
 * CONTRACT CODE is not in the blob. An account with code carries `codeHash` (its keccak256) where
 * an anvil genesis has `code`, and capture writes the code itself into the content-addressed cache
 * `node_modules/.cache/sauce-contract-code/<codeHash>.hex`. `pnpm --filter './sdk'
 * fetch-contract-code --rpc-config fixtures.rpc.config.json` fills that cache from the chain
 * (`eth_getCode`, held to the hash); replay
 * takes each code from it, hashes it again, and puts it in the genesis anvil boots from. Code
 * beginning 0xef — an EIP-7702 delegation, a node's precompile marker — is no program and stays
 * inline as `code`, and so does every code of a blob captured before this form: such a blob
 * replays exactly as it was written.
 *
 * The procedure, for maintainers, is in CLAUDE.md.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { keccak256, type Hex } from "viem";

import { freePort, spawnAnvil } from "../../sdk/test/anvil-process.js";

/** A chain a suite can be frozen on: the block, and what replay's genesis block carries from it. */
export interface CapturedChain {
  readonly chainId: number;
  /** The block its suites are frozen at. Changing it means recapturing every suite on the chain. */
  readonly block: number;
  /** `block`'s timestamp. Replay starts here; capture checks the fork agrees. */
  readonly timestamp: number;
  readonly gasLimit: number;
  readonly baseFee: number;
  /** Seconds between blocks after the pinned one, in both modes. */
  readonly blockInterval: number;
}

export const CHAINS = {
  ethereum: {
    chainId: 1,
    block: 26_070_000,
    timestamp: 1_790_526_671,
    gasLimit: 60_000_000,
    baseFee: 880_130_687,
    blockInterval: 12,
  },
  base: {
    chainId: 8453,
    block: 51_966_000,
    timestamp: 1_790_721_347,
    gasLimit: 400_000_000,
    baseFee: 5_000_000,
    blockInterval: 2,
  },
  avalanche: {
    chainId: 43114,
    block: 96_424_000,
    timestamp: 1_790_730_293,
    gasLimit: 80_000_000,
    baseFee: 5_000_000_000,
    blockInterval: 2,
  },
  optimism: {
    chainId: 10,
    block: 157_600_000,
    timestamp: 1_790_798_777,
    gasLimit: 40_000_000,
    baseFee: 869,
    blockInterval: 2,
  },
} as const satisfies Record<string, CapturedChain>;

export type ChainName = keyof typeof CHAINS;

/** The block every Ethereum suite is frozen at. Changing it means recapturing every such suite. */
export const PINNED_BLOCK = CHAINS.ethereum.block;
/** `PINNED_BLOCK`'s timestamp. */
export const PINNED_TIMESTAMP = CHAINS.ethereum.timestamp;
/** Seconds between Ethereum blocks after the pinned one, in both modes. */
export const BLOCK_INTERVAL = CHAINS.ethereum.blockInterval;
/** A deadline comfortably after anything an Ethereum suite mines: the pinned time plus a day. */
export const DEADLINE = PINNED_TIMESTAMP + 86_400;

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(HERE, "state");
/** Where a capture reads its RPC URLs: chain id -> URL. Gitignored. */
const RPC_CONFIG = resolve(HERE, "../../sdk/rpc.config.json");
/** Contract code by its keccak256, `<codeHash>.hex`: what capture writes and `fetch-contract-code` fetches. */
const CODE_CACHE = resolve(HERE, "../../node_modules/.cache/sauce-contract-code");

export const capturing = process.env.RECAPTURE_ANVIL_STATE === "1";

export interface Mainnet {
  /** The local anvil's RPC URL. */
  readonly rpc: string;
  /** Stops anvil. In capture mode, also writes the suite's state; await it. */
  stop(): Promise<void>;
}

const nativeFetch = globalThis.fetch;

/** Every `fetch` to anything but this machine throws, for the rest of the process. */
function forbidNetwork(): void {
  if ((globalThis.fetch as { guarded?: boolean }).guarded) return;
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      // Rejected, not thrown: callers handle a failed fetch as a rejected promise.
      return Promise.reject(
        new Error(
          `network access to ${url.hostname} during a replayed mainnet suite — every read must come ` +
            "from the captured state; recapture it (see CLAUDE.md) if the suite now reads more",
        ),
      );
    }
    return nativeFetch(input, init);
  };
  (guarded as { guarded?: boolean }).guarded = true;
  globalThis.fetch = guarded as typeof fetch;
}

async function rpcCall(rpc: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await nativeFetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);

  return body.result;
}

/** The captured state for `suite`, or a named error. */
function statePath(suite: string): string {
  return join(STATE_DIR, `${suite}.genesis.json.gz`);
}

/** An alloc entry of a captured genesis: `code`, or the `codeHash` that pins it. */
interface GenesisAccount {
  balance: string;
  nonce: string;
  code?: string;
  codeHash?: string;
  storage?: Record<string, string>;
}

/** The code `codeHash` names, from `CODE_CACHE`; undefined if it is not there or fails the hash. */
function cachedCode(codeHash: string): string | undefined {
  const path = join(CODE_CACHE, `${codeHash}.hex`);
  if (!existsSync(path)) return undefined;
  const code = readFileSync(path, "utf8").trim().toLowerCase();

  return /^0x([0-9a-f]{2})+$/.test(code) && keccak256(code as Hex) === codeHash ? code : undefined;
}

/**
 * The genesis anvil boots from: `blob`'s, with each `codeHash` entry's code put back from
 * `CODE_CACHE`. A blob with no `codeHash` entry is returned as its bytes, unchanged.
 */
function replayGenesis(blob: string): Buffer {
  const text = gunzipSync(readFileSync(blob));
  const genesis = JSON.parse(text.toString("utf8")) as { alloc: Record<string, GenesisAccount> };
  const pinned = Object.entries(genesis.alloc).filter(([, entry]) => entry.codeHash !== undefined);
  if (pinned.length === 0) return text;
  const missing: string[] = [];
  for (const [address, entry] of pinned) {
    const code = cachedCode(entry.codeHash!);
    if (code === undefined) {
      missing.push(`${address} (${entry.codeHash})`);
      continue;
    }
    entry.code = code;
    delete entry.codeHash;
  }
  if (missing.length > 0) {
    throw new Error(
      `${blob} pins the code of ${missing.length} account(s) that ${CODE_CACHE} does not hold (or ` +
        `holds failing its hash): ${missing.slice(0, 3).join(", ")}` +
        (missing.length > 3 ? `, and ${missing.length - 3} more` : "") +
        ". Run `pnpm --filter './sdk' fetch-contract-code --rpc-config fixtures.rpc.config.json`, " +
        "which reads them from the chain and " +
        "holds each to its hash",
    );
  }

  return Buffer.from(JSON.stringify(genesis));
}

/** Puts `code` in `CODE_CACHE` under its keccak256, which it returns. */
function cacheCode(code: string): string {
  const codeHash = keccak256(code as Hex);
  const path = join(CODE_CACHE, `${codeHash}.hex`);
  if (cachedCode(codeHash) === undefined) {
    mkdirSync(CODE_CACHE, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, code);
    renameSync(temporary, path);
  }

  return codeHash;
}

/** The capture RPC for `chain`, from `sdk/rpc.config.json` — the only place a capture reads one. */
function captureRpc(chain: CapturedChain): string {
  if (!existsSync(RPC_CONFIG)) {
    throw new Error(
      `RECAPTURE_ANVIL_STATE=1 reads its RPC from ${RPC_CONFIG}, a JSON object of chain id -> URL ` +
        "(gitignored; copy sdk/rpc.config.example.json). It is not there.",
    );
  }
  const urls = JSON.parse(readFileSync(RPC_CONFIG, "utf8")) as Record<string, unknown>;
  const url = urls[String(chain.chainId)];
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new Error(`${RPC_CONFIG} gives no RPC URL for chain ${chain.chainId}`);
  }

  return url;
}

/**
 * Starts `chain` at its pinned block on a local anvil for `suite`: replayed from its captured state,
 * or — with `RECAPTURE_ANVIL_STATE=1` — forked, to capture that state.
 */
export async function startMainnet(
  suite: string,
  chainName: ChainName = "ethereum",
): Promise<Mainnet> {
  const chain: CapturedChain = CHAINS[chainName];
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  // `spawnAnvil` adds the port and --silent, refuses a port something holds, waits for this anvil
  // (60 s: a large genesis takes a while to load), and starts the watchdog that kills it if this
  // process dies first (`sdk/test/anvil-process.ts`).
  const common = ["--chain-id", String(chain.chainId)];

  if (!capturing) {
    forbidNetwork();
    // Nothing downstream may reach for an RPC, whatever the environment carries.
    delete process.env.FORK_URL;
    const blob = statePath(suite);
    if (!existsSync(blob)) {
      throw new Error(
        `no captured ${chainName} state for '${suite}' at ${blob} — capture it (see CLAUDE.md)`,
      );
    }
    const work = mkdtempSync(join(tmpdir(), `sauce-mainnet-${suite}-`));
    const genesis = join(work, "genesis.json");
    writeFileSync(genesis, replayGenesis(blob));
    const proc = await spawnAnvil(port, ["--init", genesis, ...common], 60_000);
    try {
      await pin(rpc, chain);
      const info = (await rpcCall(rpc, "anvil_nodeInfo")) as {
        forkConfig?: { forkUrl?: string | null };
      };
      if (info.forkConfig?.forkUrl) throw new Error("a replayed mainnet anvil must not fork");
    } catch (error) {
      proc.kill("SIGKILL");
      throw error;
    }

    return {
      rpc,
      async stop() {
        proc.kill("SIGKILL");
        rmSync(work, { recursive: true, force: true });
      },
    };
  }

  const forkUrl = captureRpc(chain);
  const home = mkdtempSync(join(tmpdir(), `sauce-capture-${suite}-`));
  const recorder = await startRecorder(forkUrl, home, chain);
  const proc = await spawnAnvil(
    port,
    ["--fork-url", recorder.url, "--fork-block-number", String(chain.block), ...common],
    60_000,
    // A private HOME, so the fork writes no RPC cache into the maintainer's own.
    { ...process.env, HOME: home },
  );
  const devAccounts = (await rpcCall(rpc, "eth_accounts")) as string[];
  for (const account of devAccounts) await rpcCall(rpc, "anvil_setCode", [account, "0x"]);
  await pin(rpc, chain);

  return {
    rpc,
    async stop() {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGTERM");
      await exited;
      const recorded = await recorder.close();
      rmSync(home, { recursive: true, force: true });
      const genesis = genesisFrom(recorded, devAccounts, chain);
      const text = JSON.stringify(genesis);
      const host = new URL(forkUrl).host;
      if (text.includes(forkUrl) || text.includes(host)) {
        throw new Error("the captured state mentions the RPC — refusing to write it");
      }
      const blob = gzipSync(text, { level: 9 });
      writeFileSync(statePath(suite), blob);
      console.log(
        `captured ${suite} (${chainName} ${chain.block}): ${Object.keys(genesis.alloc).length} ` +
          `accounts, ${text.length} bytes, ${blob.length} gzipped`,
      );
    },
  };
}

interface RecordedAccount {
  balance?: string;
  nonce?: string;
  code?: string;
  storage: Record<string, string>;
}

const hexBlock = (chain: CapturedChain): string => `0x${chain.block.toString(16)}`;

/**
 * Starts `mainnet-recorder.mjs`: a JSON-RPC proxy, in its own process, forwarding to `upstream` and
 * recording every account and slot it answers. `close()` stops it and returns the records.
 */
async function startRecorder(upstream: string, work: string, chain: CapturedChain) {
  const out = join(work, "recorded.json");
  const proc = spawn(process.execPath, [join(HERE, "mainnet-recorder.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      SAUCE_CAPTURE_UPSTREAM: upstream,
      SAUCE_CAPTURE_BLOCK: hexBlock(chain),
      SAUCE_CAPTURE_OUT: out,
    },
  });
  const port = await new Promise<number>((ok, fail) => {
    proc.stdout!.once("data", (chunk: Buffer) => ok(Number(chunk.toString().trim())));
    proc.once("exit", (code) => fail(new Error(`the capture recorder exited with code ${code}`)));
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async close(): Promise<Map<string, RecordedAccount>> {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGTERM");
      await exited;
      const { accounts, errors } = JSON.parse(readFileSync(out, "utf8")) as {
        accounts: Record<string, RecordedAccount>;
        errors: string[];
      };
      if (errors.length > 0) throw new Error(`the capture recorder failed: ${errors.join("; ")}`);

      return new Map(Object.entries(accounts));
    },
  };
}

/** Both modes: the same chain time after the pinned block, whatever the wall clock says. */
async function pin(rpc: string, chain: CapturedChain): Promise<void> {
  const block = (await rpcCall(rpc, "eth_getBlockByNumber", ["latest", false])) as {
    number: string;
    timestamp: string;
  };
  if (Number(block.number) !== chain.block || Number(block.timestamp) !== chain.timestamp) {
    throw new Error(
      `anvil is at block ${Number(block.number)} (${Number(block.timestamp)}), not the pinned ` +
        `${chain.block} (${chain.timestamp})`,
    );
  }
  await rpcCall(rpc, "anvil_setBlockTimestampInterval", [chain.blockInterval]);
}

/** The recorded accounts as an anvil genesis at the pinned block, without anvil's own dev accounts. */
function genesisFrom(
  accounts: ReadonlyMap<string, RecordedAccount>,
  devAccounts: readonly string[],
  chain: CapturedChain,
) {
  const dev = new Set(devAccounts.map((a) => a.toLowerCase()));
  const alloc: Record<string, Record<string, unknown>> = {};
  for (const address of [...accounts.keys()].sort()) {
    if (dev.has(address)) continue;
    const recorded = accounts.get(address)!;
    const entry: Record<string, unknown> = {
      balance: recorded.balance ?? "0x0",
      nonce: recorded.nonce ?? "0x0",
    };
    if (recorded.code && recorded.code !== "0x") {
      // 0xef-led code, which EIP-3541 keeps out of deployed code, is an EIP-7702 delegation or a
      // node's marker, not a program: it stays inline. Any other code goes to the cache.
      if (/^0xef/i.test(recorded.code)) entry.code = recorded.code;
      else entry.codeHash = cacheCode(recorded.code.toLowerCase());
    }
    const slots = Object.keys(recorded.storage).sort();
    if (slots.length > 0)
      entry.storage = Object.fromEntries(slots.map((k) => [k, recorded.storage[k]!]));
    alloc[address] = entry;
  }

  return {
    config: { chainId: chain.chainId },
    number: hexBlock(chain),
    timestamp: `0x${chain.timestamp.toString(16)}`,
    gasLimit: `0x${chain.gasLimit.toString(16)}`,
    baseFeePerGas: `0x${chain.baseFee.toString(16)}`,
    difficulty: "0x0",
    coinbase: "0x0000000000000000000000000000000000000000",
    alloc,
  };
}

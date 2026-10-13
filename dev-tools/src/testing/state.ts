/**
 * A forked chain on a local anvil, pinned to one block, in one of three modes:
 *
 * - **replay**: anvil boots from a recorded state file (`--init`), at the pinned block's number and
 *   timestamp, on the chain's id. No RPC, no network, the same result on every run.
 * - **record**: anvil forks the chain at the pinned block through a recording proxy (`recorder.mjs`,
 *   its own process), and `stop()` writes every account and storage slot the run read — their
 *   values AT the pinned block, before the run changed them — to the state file.
 * - **live**: a plain fork at the pinned block, nothing recorded.
 *
 * Either way each later block is `blockInterval` seconds after the previous one, so nothing depends
 * on the wall clock. A state file is gzipped JSON: `{ sauce: { chainId, block, timestamp,
 * blockInterval, hardfork, nextBaseFee, nonces }, genesis }`, where `genesis` is an anvil genesis
 * without anvil's own dev accounts (a replaying anvil creates them). Replay only knows what the
 * recording run read: a test that starts reading something new reads zeros there, so record again
 * after changing what tests do.
 *
 * A replay runs on the node the recording ran on. What a fork takes from the chain and anvil's
 * `--init` does not, the recording writes down and the replay sets: the block gas limit and the
 * hardfork (anvil infers it from the block it forks) as flags, and, once the node is up, the next
 * block's base fee (a fork steps it from the pinned block's gas, `--init` carries the pinned block's
 * forward) and the dev accounts' nonces (a fork keeps the chain's). What a replay cannot reproduce
 * is a block hash, or a block's PREVRANDAO, which anvil derives from the one before it.
 *
 * Anvil's dev accounts are made plain accounts in every fork: their keys are public, and some carry
 * an EIP-7702 delegation on mainnets, which would make tokens check their signatures through it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { rpc, startAnvil, stopWithProcess, type AnvilProcess } from "./node.js";

export type ForkMode = "replay" | "record" | "live";

interface StateHeader {
  readonly chainId: number;
  readonly block: number;
  readonly timestamp: number;
  readonly blockInterval: number;
  /** The hardfork the fork ran, as anvil's `--hardfork` names it. */
  readonly hardfork: string;
  /** The base fee of the block after the pinned one, as the fork computed it; none before
   *  EIP-1559. */
  readonly nextBaseFee?: string;
  /** Anvil's dev accounts' nonces at the pinned block, those that are not 0. */
  readonly nonces: Readonly<Record<string, number>>;
}

interface StateFile {
  readonly sauce: StateHeader & { readonly version: 2 };
  readonly genesis: Record<string, unknown> & {
    readonly gasLimit: string;
    alloc: Record<string, unknown>;
  };
}

export interface ForkNode {
  readonly url: string;
  readonly mode: ForkMode;
  /** Stops anvil; in record mode, also writes the state file. Await it. */
  stop(): Promise<void>;
}

export interface ForkNodeOptions {
  readonly chainId: number;
  readonly block: number;
  readonly blockInterval: number;
  readonly mode: ForkMode;
  /** Record and live: the chain's RPC. It must serve state at `block`. */
  readonly rpcUrl?: string;
  /** Replay and record: the state file. */
  readonly state?: string;
  readonly anvil?: string;
}

interface Header {
  readonly number: string;
  readonly timestamp: string;
  readonly gasLimit: string;
  readonly baseFeePerGas?: string;
}

const latest = (url: string) =>
  rpc(url, "eth_getBlockByNumber", ["latest", false]) as Promise<Header>;

/** What anvil runs as: its hardfork, and the next block's base fee. */
interface NodeInfo {
  readonly hardFork: string;
  readonly environment: { readonly baseFee: string };
}

const nodeInfo = (url: string) => rpc(url, "anvil_nodeInfo") as Promise<NodeInfo>;

/** Every later block `interval` seconds after the one before it, from where the node is now. */
async function pinClock(url: string, interval: number): Promise<void> {
  await rpc(url, "anvil_setBlockTimestampInterval", [interval]);
}

/** Anvil's dev accounts, made plain accounts (see the module's header). */
async function plainDevAccounts(url: string): Promise<string[]> {
  const accounts = (await rpc(url, "eth_accounts")) as string[];
  // Independent writes, one per account: sent together.
  await Promise.all(accounts.map((account) => rpc(url, "anvil_setCode", [account, "0x"])));

  return accounts;
}

/** The nonces of `accounts` that are not 0, by lowercase address. */
async function noncesOf(url: string, accounts: readonly string[]): Promise<Record<string, number>> {
  const nonces = await Promise.all(
    accounts.map(async (account) => {
      const nonce = Number(await rpc(url, "eth_getTransactionCount", [account, "latest"]));

      return [account.toLowerCase(), nonce] as const;
    }),
  );

  return Object.fromEntries(nonces.filter(([, nonce]) => nonce > 0));
}

export async function startForkNode(options: ForkNodeOptions): Promise<ForkNode> {
  const { chainId, block, blockInterval, mode } = options;
  switch (mode) {
    case "replay":
      return replay(options.state!, chainId, block, options.anvil);
    case "record":
      return record(options, options.state!, options.rpcUrl!);
    case "live": {
      const node = await startAnvil(
        [
          "--fork-url",
          options.rpcUrl!,
          "--fork-block-number",
          String(block),
          "--chain-id",
          String(chainId),
        ],
        options.anvil === undefined ? {} : { binary: options.anvil },
      );
      await plainDevAccounts(node.url);
      await pinClock(node.url, blockInterval);

      return { url: node.url, mode, stop: node.stop };
    }
  }
}

async function replay(
  state: string,
  chainId: number,
  block: number,
  anvil: string | undefined,
): Promise<ForkNode> {
  const file = JSON.parse(gunzipSync(readFileSync(state)).toString("utf8")) as StateFile;
  const header = file.sauce;
  if ((header?.version as number) === 1) {
    throw new Error(
      `${state} was recorded by an earlier testing kit, which did not record the node a replay ` +
        "must run on: record it again",
    );
  }
  if (header?.version !== 2) throw new Error(`${state} is not a recorded chain state`);
  if (header.chainId !== chainId || header.block !== block) {
    throw new Error(
      `${state} holds chain ${header.chainId} at block ${header.block}, not chain ${chainId} at ` +
        `${block}: record it again for the new block`,
    );
  }
  const work = mkdtempSync(join(tmpdir(), "sauce-replay-"));
  const genesis = join(work, "genesis.json");
  writeFileSync(genesis, JSON.stringify(file.genesis));
  const gasLimit = BigInt(file.genesis.gasLimit);
  let node: AnvilProcess;
  try {
    node = await startAnvil(
      [
        "--init",
        genesis,
        "--chain-id",
        String(chainId),
        // `--init` takes neither from the genesis.
        "--gas-limit",
        String(gasLimit),
        "--hardfork",
        header.hardfork,
      ],
      anvil === undefined ? {} : { binary: anvil },
    );
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
  try {
    const [head, info] = await Promise.all([latest(node.url), nodeInfo(node.url)]);
    const booted = {
      block: Number(head.number),
      timestamp: Number(head.timestamp),
      gasLimit: BigInt(head.gasLimit),
      hardfork: info.hardFork.toLowerCase(),
    };
    const expected = { block, timestamp: header.timestamp, gasLimit, hardfork: header.hardfork };
    if (
      Object.entries(expected).some(([key, value]) => booted[key as keyof typeof booted] !== value)
    ) {
      throw new Error(
        `the replayed node runs at ${described(booted)}, not the recorded ${described(expected)}`,
      );
    }
    // What `--init` cannot be given: set once the node is up, before anything is mined.
    if (header.nextBaseFee !== undefined) {
      await rpc(node.url, "anvil_setNextBlockBaseFeePerGas", [header.nextBaseFee]);
    }
    await Promise.all(
      Object.entries(header.nonces).map(([account, nonce]) =>
        rpc(node.url, "anvil_setNonce", [account, `0x${nonce.toString(16)}`]),
      ),
    );
    await pinClock(node.url, header.blockInterval);
  } catch (error) {
    await node.stop();
    rmSync(work, { recursive: true, force: true });
    throw error;
  }

  return {
    url: node.url,
    mode: "replay",
    async stop() {
      await node.stop();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

const described = (node: {
  block: number;
  timestamp: number;
  gasLimit: bigint;
  hardfork: string;
}) => `block ${node.block} (${node.timestamp}), gas limit ${node.gasLimit}, ${node.hardfork}`;

interface RecordedAccount {
  balance?: string;
  nonce?: string;
  code?: string;
  storage: Record<string, string>;
}

const RECORDER = join(dirname(fileURLToPath(import.meta.url)), "recorder.mjs");

/** Starts the recording proxy in front of `upstream`. `close()` stops it and returns the records. */
async function startRecorder(upstream: string, block: number, work: string) {
  const out = join(work, "recorded.json");
  const child = spawn(process.execPath, [RECORDER], { stdio: ["pipe", "pipe", "inherit"] });
  stopWithProcess(child);
  child.stdin!.end(JSON.stringify({ upstream, block: `0x${block.toString(16)}`, out }));
  const port = await new Promise<number>((ok, fail) => {
    child.stdout!.once("data", (chunk: Buffer) => ok(Number(chunk.toString().trim())));
    child.once("exit", (code) => fail(new Error(`the recorder exited with code ${code}`)));
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async close(): Promise<Map<string, RecordedAccount>> {
      const exited = new Promise((ok) => child.once("exit", ok));
      child.kill("SIGTERM");
      await exited;
      const { accounts, errors } = JSON.parse(readFileSync(out, "utf8")) as {
        accounts: Record<string, RecordedAccount>;
        errors: string[];
      };
      if (errors.length > 0) throw new Error(`recording failed: ${errors.join("; ")}`);

      return new Map(Object.entries(accounts));
    },
  };
}

async function record(
  options: ForkNodeOptions,
  state: string,
  upstream: string,
): Promise<ForkNode> {
  const { chainId, block, blockInterval } = options;
  const work = mkdtempSync(join(tmpdir(), "sauce-record-"));
  const recorder = await startRecorder(upstream, block, work);
  let node: AnvilProcess;
  try {
    node = await startAnvil(
      [
        "--fork-url",
        recorder.url,
        "--fork-block-number",
        String(block),
        "--chain-id",
        String(chainId),
        // No RPC cache, read or written: every read goes through the recorder, never a cache a
        // previous run left.
        "--no-storage-caching",
      ],
      options.anvil === undefined ? {} : { binary: options.anvil },
    );
  } catch (error) {
    await recorder.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
  let head: Header;
  let info: NodeInfo;
  let devAccounts: string[];
  let nonces: Record<string, number>;
  try {
    // Read before anything is mined: `info` holds the next block's base fee.
    [head, info] = await Promise.all([latest(node.url), nodeInfo(node.url)]);
    devAccounts = await plainDevAccounts(node.url);
    nonces = await noncesOf(node.url, devAccounts);
    await pinClock(node.url, blockInterval);
  } catch (error) {
    await node.stop();
    await recorder.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    throw error;
  }

  return {
    url: node.url,
    mode: "record",
    async stop() {
      await node.stop();
      const recorded = await recorder.close();
      rmSync(work, { recursive: true, force: true });
      const file: StateFile = {
        sauce: {
          version: 2,
          chainId,
          block,
          timestamp: Number(head.timestamp),
          blockInterval,
          hardfork: info.hardFork.toLowerCase(),
          // A chain before EIP-1559 has no base fee to carry.
          ...(head.baseFeePerGas === undefined ? {} : { nextBaseFee: info.environment.baseFee }),
          nonces,
        },
        genesis: genesisFrom(recorded, devAccounts, chainId, head),
      };
      const text = JSON.stringify(file);
      const host = new URL(upstream).host;
      if (text.includes(upstream) || text.includes(host)) {
        throw new Error("the recorded state mentions the RPC: refusing to write it");
      }
      mkdirSync(dirname(state), { recursive: true });
      writeFileSync(state, gzipSync(text, { level: 9 }));
    },
  };
}

/** The recorded accounts as an anvil genesis at the pinned block, without anvil's dev accounts. */
function genesisFrom(
  accounts: ReadonlyMap<string, RecordedAccount>,
  devAccounts: readonly string[],
  chainId: number,
  head: Header,
): StateFile["genesis"] {
  const dev = new Set(devAccounts.map((account) => account.toLowerCase()));
  const alloc: Record<string, Record<string, unknown>> = {};
  for (const address of [...accounts.keys()].sort()) {
    if (dev.has(address)) continue;
    const recorded = accounts.get(address)!;
    const entry: Record<string, unknown> = {
      balance: recorded.balance ?? "0x0",
      nonce: recorded.nonce ?? "0x0",
    };
    if (recorded.code && recorded.code !== "0x") entry.code = recorded.code;
    const slots = Object.keys(recorded.storage).sort();
    if (slots.length > 0) {
      entry.storage = Object.fromEntries(slots.map((slot) => [slot, recorded.storage[slot]!]));
    }
    alloc[address] = entry;
  }

  return {
    config: { chainId },
    number: head.number,
    timestamp: head.timestamp,
    gasLimit: head.gasLimit,
    baseFeePerGas: head.baseFeePerGas ?? "0x0",
    difficulty: "0x0",
    coinbase: "0x0000000000000000000000000000000000000000",
    alloc,
  };
}

/** Whether a state file exists at `path`. */
export const recorded = (path: string): boolean => existsSync(path);

/**
 * Ethereum mainnet, frozen at one block, as a LOCAL anvil — so the prod-like suites run against
 * real deployed contracts with no RPC and no network at all. NOT a `.test.ts`.
 *
 * REPLAY (every normal run). `tests/state/<suite>.genesis.json.gz` is a genesis file holding every
 * account and storage slot that suite read from mainnet at `PINNED_BLOCK`. Anvil boots from it
 * (`--init`) at that block number, with its timestamp, on chain id 1, and each later block is
 * `BLOCK_INTERVAL` seconds after the previous one — so nothing depends on when the suite runs.
 * Replay refuses to fork, and makes every non-loopback `fetch` throw: a suite that quietly needs
 * the network fails loudly instead of hanging or reading zeros.
 *
 * CAPTURE (only on request). `RECAPTURE_ANVIL_STATE=1` with `FORK_URL` (an Ethereum archive RPC)
 * forks mainnet at `PINNED_BLOCK` instead, runs the same suite, and on `stop()` rewrites the
 * suite's genesis from what the fork read. The fork reads through a local recording proxy, which
 * forwards to the RPC and keeps every account (`eth_getAccountInfo`, `eth_getBalance`, `eth_getCode`,
 * `eth_getTransactionCount`) and storage slot (`eth_getStorageAt`) it answered — values AT the pinned
 * block, before the suite changed anything. Neither of anvil's own mechanisms works: on a fork
 * `anvil_dumpState` holds only locally modified accounts, and Foundry's RPC cache loses whatever was
 * fetched after a snapshot as soon as the suite reverts it, which these suites do around every test.
 * Anvil's dev accounts are left out (a replaying anvil creates them), and in capture their mainnet
 * code is cleared — the dev keys are public, and one carries an EIP-7702 delegation on mainnet — so
 * capture and replay execute the same code. `stop()` checks the blob names no RPC before writing it.
 *
 * The procedure, for maintainers, is in CLAUDE.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

/** The block every mainnet suite is frozen at. Changing it means recapturing every suite. */
export const PINNED_BLOCK = 26_070_000;
/** `PINNED_BLOCK`'s timestamp. Replay starts here; capture checks the fork agrees. */
export const PINNED_TIMESTAMP = 1_790_526_671;
/** `PINNED_BLOCK`'s gas limit and base fee, which replay's genesis block carries. */
const PINNED_GAS_LIMIT = 60_000_000;
const PINNED_BASE_FEE = 880_130_687;
/** Seconds between blocks after the pinned one, in both modes. */
export const BLOCK_INTERVAL = 12;
/** A deadline comfortably after anything a suite mines: the pinned time plus a day. */
export const DEADLINE = PINNED_TIMESTAMP + 86_400;

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(HERE, "state");

export const capturing = process.env.RECAPTURE_ANVIL_STATE === "1";

export interface Mainnet {
  /** The local anvil's RPC URL. */
  readonly rpc: string;
  /** Stops anvil. In capture mode, also writes the suite's state; await it. */
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => ok(port));
    });
    server.on("error", fail);
  });
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

async function waitFor(rpc: string, proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (proc.exitCode !== null) throw new Error(`anvil exited with code ${proc.exitCode}`);
    try {
      await rpcCall(rpc, "eth_chainId");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil did not start within 60s");
}

/** The captured state for `suite`, or a named error. */
function statePath(suite: string): string {
  return join(STATE_DIR, `${suite}.genesis.json.gz`);
}

/**
 * Starts mainnet-at-`PINNED_BLOCK` on a local anvil for `suite`: replayed from its captured state,
 * or — with `RECAPTURE_ANVIL_STATE=1` and `FORK_URL` — forked, to capture that state.
 */
export async function startMainnet(suite: string): Promise<Mainnet> {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const common = ["--port", String(port), "--silent", "--chain-id", "1"];

  if (!capturing) {
    forbidNetwork();
    // Nothing downstream may reach for an RPC, whatever the environment carries.
    delete process.env.FORK_URL;
    const blob = statePath(suite);
    if (!existsSync(blob)) {
      throw new Error(
        `no captured mainnet state for '${suite}' at ${blob} — capture it (see CLAUDE.md)`,
      );
    }
    const work = mkdtempSync(join(tmpdir(), `sauce-mainnet-${suite}-`));
    const genesis = join(work, "genesis.json");
    writeFileSync(genesis, gunzipSync(readFileSync(blob)));
    const proc = spawn("anvil", ["--init", genesis, ...common], { stdio: "ignore" });
    try {
      await waitFor(rpc, proc);
      await pin(rpc);
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

  const forkUrl = process.env.FORK_URL;
  if (!forkUrl)
    throw new Error("RECAPTURE_ANVIL_STATE=1 needs FORK_URL, an Ethereum mainnet archive RPC");
  const home = mkdtempSync(join(tmpdir(), `sauce-capture-${suite}-`));
  const recorder = await startRecorder(forkUrl, home);
  const proc = spawn(
    "anvil",
    ["--fork-url", recorder.url, "--fork-block-number", String(PINNED_BLOCK), ...common],
    // A private HOME, so the fork writes no RPC cache into the maintainer's own.
    { stdio: "ignore", env: { ...process.env, HOME: home } },
  );
  await waitFor(rpc, proc);
  const devAccounts = (await rpcCall(rpc, "eth_accounts")) as string[];
  for (const account of devAccounts) await rpcCall(rpc, "anvil_setCode", [account, "0x"]);
  await pin(rpc);

  return {
    rpc,
    async stop() {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGTERM");
      await exited;
      const recorded = await recorder.close();
      rmSync(home, { recursive: true, force: true });
      const genesis = genesisFrom(recorded, devAccounts);
      const text = JSON.stringify(genesis);
      const host = new URL(forkUrl).host;
      if (text.includes(forkUrl) || text.includes(host)) {
        throw new Error("the captured state mentions the RPC — refusing to write it");
      }
      const blob = gzipSync(text, { level: 9 });
      writeFileSync(statePath(suite), blob);
      console.log(
        `captured ${suite}: ${Object.keys(genesis.alloc).length} accounts, ${text.length} bytes, ` +
          `${blob.length} gzipped`,
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

const PINNED_TAG = `0x${PINNED_BLOCK.toString(16)}`;

/**
 * Starts `mainnet-recorder.mjs`: a JSON-RPC proxy, in its own process, forwarding to `upstream` and
 * recording every account and slot it answers. `close()` stops it and returns the records.
 */
async function startRecorder(upstream: string, work: string) {
  const out = join(work, "recorded.json");
  const proc = spawn(process.execPath, [join(HERE, "mainnet-recorder.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      SAUCE_CAPTURE_UPSTREAM: upstream,
      SAUCE_CAPTURE_BLOCK: PINNED_TAG,
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
async function pin(rpc: string): Promise<void> {
  const block = (await rpcCall(rpc, "eth_getBlockByNumber", ["latest", false])) as {
    number: string;
    timestamp: string;
  };
  if (Number(block.number) !== PINNED_BLOCK || Number(block.timestamp) !== PINNED_TIMESTAMP) {
    throw new Error(
      `anvil is at block ${Number(block.number)} (${Number(block.timestamp)}), not the pinned ` +
        `${PINNED_BLOCK} (${PINNED_TIMESTAMP})`,
    );
  }
  await rpcCall(rpc, "anvil_setBlockTimestampInterval", [BLOCK_INTERVAL]);
}

/** The recorded accounts as an anvil genesis at the pinned block, without anvil's own dev accounts. */
function genesisFrom(
  accounts: ReadonlyMap<string, RecordedAccount>,
  devAccounts: readonly string[],
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
    if (recorded.code && recorded.code !== "0x") entry.code = recorded.code;
    const slots = Object.keys(recorded.storage).sort();
    if (slots.length > 0)
      entry.storage = Object.fromEntries(slots.map((k) => [k, recorded.storage[k]!]));
    alloc[address] = entry;
  }

  return {
    config: { chainId: 1 },
    number: PINNED_TAG,
    timestamp: `0x${PINNED_TIMESTAMP.toString(16)}`,
    gasLimit: `0x${PINNED_GAS_LIMIT.toString(16)}`,
    baseFeePerGas: `0x${PINNED_BASE_FEE.toString(16)}`,
    difficulty: "0x0",
    coinbase: "0x0000000000000000000000000000000000000000",
    alloc,
  };
}

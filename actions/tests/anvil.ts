/**
 * An anvil with the released v12 engine behind a real Kitchen-minted Pot, for suites that EXECUTE
 * action programs — locally with nothing forked, or against a fork of a live chain.
 *
 * NOT a `.test.ts`, so the runner never collects it.
 *
 * The engine's creation code comes from `SAUCE_V12_RUNTIME_CREATION_HEX` (a file of hex, which
 * `sync-engine-artifacts --fetch-v12-engines` prints) or else the synced
 * `sdk/{dist,src}/artifacts/V12RuntimeBytecode.json`. With neither, `engineCreationCode()` returns
 * undefined and a suite skips — except under CI, where it throws, so an unrun suite cannot pass.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { cookData, startGatedEngine } from "./gated-engine.js";
import { startMainnet } from "./mainnet.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Anvil's first dev account: the Pot's owner, the only account that may `cook`. */
export const OWNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** The engine's creation code, or undefined when nothing has synced it (throws under CI). */
export function engineCreationCode(): Hex | undefined {
  const override = process.env.SAUCE_V12_RUNTIME_CREATION_HEX;
  if (override) return `0x${readFileSync(override, "utf8").trim().replace(/^0x/, "")}` as Hex;
  for (const dir of ["sdk/dist/artifacts", "sdk/src/artifacts"]) {
    const path = resolve(REPO_ROOT, dir, "V12RuntimeBytecode.json");
    if (existsSync(path)) {
      return (JSON.parse(readFileSync(path, "utf8")) as { runtimeCreationCode: Hex })
        .runtimeCreationCode;
    }
  }
  if (process.env.CI) {
    throw new Error(
      "no v12 engine creation code: set SAUCE_V12_RUNTIME_CREATION_HEX or run " +
        "`pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines` — CI must not skip this suite",
    );
  }

  return undefined;
}

/** The reason a suite skips, or false when it can run. */
export function skipReason(): string | false {
  return engineCreationCode() === undefined
    ? "no v12 engine artifact (run `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`)"
    : false;
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

export type Anvil = Awaited<ReturnType<typeof startAnvil>>;

/**
 * Starts anvil on a free port — empty, or, with `mainnet`, Ethereum mainnet frozen at the pinned
 * block from that suite's captured state (`mainnet.ts`) — deploys the engine, the Kitchen and the
 * Pot, and returns clients plus `cook`. Stop it with `stop()`, and await it: in capture mode it
 * writes the suite's state.
 */
export async function startAnvil(options: { mainnet?: string } = {}) {
  const creation = engineCreationCode();
  if (creation === undefined) throw new Error(skipReason() as string);

  let rpc: string;
  let stopNode: () => Promise<void>;
  if (options.mainnet !== undefined) {
    const node = await startMainnet(options.mainnet);
    rpc = node.rpc;
    stopNode = () => node.stop();
  } else {
    const port = await freePort();
    const proc: ChildProcess = spawn(
      "anvil",
      ["--port", String(port), "--silent", "--gas-limit", "100000000"],
      { stdio: "ignore" },
    );
    rpc = `http://127.0.0.1:${port}`;
    stopNode = async () => {
      proc.kill("SIGKILL");
    };
  }

  const probe = createPublicClient({ transport: http(rpc) });
  let chainId = 0;
  for (let i = 0; i < 300 && chainId === 0; i++) {
    try {
      chainId = await probe.getChainId();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (chainId === 0) {
    await stopNode();
    throw new Error("anvil did not start");
  }

  const chain = defineChain({
    id: chainId,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(OWNER_KEY);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
  const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpc) });

  const { engine, pot } = await startGatedEngine(
    REPO_ROOT,
    { publicClient: publicClient as never, walletClient, chain },
    account.address,
    creation,
    (address, bytecode) => testClient.setCode({ address, bytecode }),
    (address, index, value) => testClient.setStorageAt({ address, index, value }),
  );

  /** Sends `program` through the Pot's `cook`. Resolves to the receipt, reverted or not. */
  const cook = async (program: Uint8Array, value = 0n): Promise<TransactionReceipt> => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: pot,
      data: cookData(engine, program),
      value,
      gas: 30_000_000n,
    });

    return publicClient.waitForTransactionReceipt({ hash });
  };

  /** Sends a prepared call (a route's `{ target, data, value }`) from the Pot's owner. */
  const send = async (call: {
    to: Address;
    data: Hex;
    value?: bigint;
  }): Promise<TransactionReceipt> => {
    const hash = await walletClient.sendTransaction({ account, chain, ...call, gas: 30_000_000n });

    return publicClient.waitForTransactionReceipt({ hash });
  };

  return {
    rpc,
    chain,
    account,
    publicClient,
    testClient,
    walletClient,
    engine,
    pot,
    cook,
    send,
    stop: stopNode,
  };
}

/**
 * Runtime code that records the call it receives and returns `ret`: it LOG1s its calldata with the
 * call's value as the topic. Execution through a binding the engine makes is then observable byte
 * for byte, with no contract of the real protocol behind it.
 *
 * `balanceOf(address)` is answered WITHOUT a log: a binding calls a `view` method with STATICCALL,
 * and a log inside a static call reverts. So balance reads are never recorded.
 *
 *   PUSH0 CALLDATALOAD PUSH1 0xe0 SHR PUSH4 balanceOf EQ PUSH2 ret JUMPI
 *   CALLDATASIZE PUSH0 PUSH0 CALLDATACOPY          mem[0..] = calldata
 *   CALLVALUE CALLDATASIZE PUSH0 LOG1              log(calldata, topic = value)
 *   ret: JUMPDEST
 *   PUSH2 len PUSH2 0x0025 PUSH0 CODECOPY          mem[0..] = code[37..37+len]
 *   PUSH2 len PUSH0 RETURN                         return it
 */
export function recorderCode(ret: Hex = "0x"): Hex {
  const body = ret.slice(2);
  const len = (body.length / 2).toString(16).padStart(4, "0");
  const logic =
    "5f3560e01c6370a0823114610017" +
    "57" +
    "365f5f37" +
    "34365fa1" +
    "5b" +
    `61${len}6100255f39` +
    `61${len}5ff3`;
  if (logic.length / 2 !== 0x25) throw new Error(`recorder logic is ${logic.length / 2} bytes`);

  return `0x${logic}${body}` as Hex;
}

/** The calls `receipt` recorded on each recorder, in order: calldata and attached value. */
export function recordedCalls(
  receipt: TransactionReceipt,
  recorders: readonly Address[],
): Array<{ to: Address; data: Hex; value: bigint }> {
  const wanted = new Set(recorders.map((a) => a.toLowerCase()));

  return receipt.logs
    .filter((log) => wanted.has(log.address.toLowerCase()) && log.topics.length === 1)
    .map((log) => ({ to: log.address, data: log.data, value: BigInt(log.topics[0]!) }));
}

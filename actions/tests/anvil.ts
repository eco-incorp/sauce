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
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
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

// The SDK's own harness, so every suite in the repository stands the stack up one way: from
// creation code, at the release addresses.
import { freePort, spawnAnvil } from "../../sdk/test/anvil-process.js";
import { startGatedEngine } from "../../sdk/test/evm/gated-engine.js";
import { startMainnet, type ChainName } from "./mainnet.js";

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

export type Anvil = Awaited<ReturnType<typeof startAnvil>>;

/**
 * Starts anvil on a free port — empty, or, with `mainnet`, a chain (`chain`, Ethereum by default)
 * frozen at its pinned block from that suite's captured state (`mainnet.ts`) — deploys the engine,
 * the Kitchen and the Pot, and returns clients plus `cook`. Stop it with `stop()`, and await it: in
 * capture mode it writes the suite's state.
 */
export async function startAnvil(options: { mainnet?: string; chain?: ChainName } = {}) {
  const creation = engineCreationCode();
  if (creation === undefined) throw new Error(skipReason() as string);

  let rpc: string;
  let stopNode: () => Promise<void>;
  if (options.mainnet !== undefined) {
    const node = await startMainnet(options.mainnet, options.chain);
    rpc = node.rpc;
    stopNode = () => node.stop();
  } else {
    // Refused on a port something holds, and killed by a watchdog if this process dies first
    // (`sdk/test/anvil-process.ts`).
    const port = await freePort();
    const proc: ChildProcess = await spawnAnvil(port, ["--gas-limit", "100000000"]);
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

  const { engine, pot, router, cookData } = await startGatedEngine(
    { publicClient: publicClient as never, walletClient, testClient: testClient as never },
    account.address,
    creation,
  );

  // Execution and quoting use separate release-pinned Routers.
  const quoteArtifact = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "sdk/src/artifacts/V12QuoteRouter.json"), "utf8"),
  ) as { bytecode: Hex; address: Address };
  const quoteDeployment = await walletClient.sendTransaction({ data: quoteArtifact.bytecode });
  const quoteReceipt = await publicClient.waitForTransactionReceipt({ hash: quoteDeployment });
  if (quoteReceipt.status !== "success" || !quoteReceipt.contractAddress) {
    throw new Error("the quote service deployment failed");
  }
  const quoteCode = await publicClient.getCode({ address: quoteReceipt.contractAddress });
  await testClient.setCode({ address: quoteArtifact.address, bytecode: quoteCode! });

  /** Sends `program` through the Pot's `cook`. Resolves to the receipt, reverted or not. */
  const cook = async (
    program: Uint8Array,
    value = 0n,
    gas = 30_000_000n,
  ): Promise<TransactionReceipt> => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: pot,
      data: cookData(bytesToHex(program)),
      value,
      gas,
    });

    return publicClient.waitForTransactionReceipt({ hash });
  };

  /** Runs `program` as an `eth_call` of the Pot's `cook` from its owner: the bytes `main` returned. */
  const returned = async (program: Uint8Array): Promise<Hex> => {
    const { data } = await publicClient.call({
      account,
      to: pot,
      data: cookData(bytesToHex(program)),
      gas: 30_000_000n,
    });

    return data ?? "0x";
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
    router,
    quoteRouter: quoteArtifact.address,
    pot,
    cook,
    returned,
    send,
    stop: stopNode,
  };
}

/** The views every recorder answers: the balance a delta reads, and the allowance an approve reads. */
const DEFAULT_VIEWS: Readonly<Record<string, Hex>> = {
  "0x70a08231": `0x${"00".repeat(32)}`, // balanceOf(address)
  "0xdd62ed3e": `0x${"00".repeat(32)}`, // allowance(address,address)
};

/**
 * Runtime code that records the call it receives and returns `ret`: it LOG1s its calldata with the
 * call's value as the topic. Execution through a binding the engine makes is then observable byte
 * for byte, with no contract of the real protocol behind it.
 *
 * A VIEW — a selector in `views`, plus `balanceOf` and `allowance` — is answered with its own
 * returndata and WITHOUT a log: the program reads a view with STATICCALL, and a log inside a static
 * call reverts. So views are never recorded.
 *
 *   PUSH0 CALLDATALOAD PUSH1 0xe0 SHR                            selector
 *   per view i: DUP1 PUSH4 sel EQ PUSH2 view_i JUMPI
 *   CALLDATASIZE PUSH0 PUSH0 CALLDATACOPY CALLVALUE CALLDATASIZE PUSH0 LOG1
 *   PUSH2 len PUSH2 at PUSH0 CODECOPY PUSH2 len PUSH0 RETURN     return `ret`
 *   per view i: JUMPDEST, then the same return of its own data
 */
export function recorderCode(ret: Hex = "0x", views: Readonly<Record<string, Hex>> = {}): Hex {
  const answers = Object.entries({ ...DEFAULT_VIEWS, ...views });
  const u16 = (n: number): string => n.toString(16).padStart(4, "0");
  const k = answers.length;
  const logicLength = 26 + 25 * k;
  const payloads = [ret, ...answers.map(([, data]) => data)].map((hex) => hex.slice(2));
  const offsets = payloads.reduce<number[]>(
    (at, payload, i) => [...at, i === 0 ? logicLength : at[i - 1]! + payloads[i - 1]!.length / 2],
    [],
  );
  const returns = (i: number): string =>
    `61${u16(payloads[i]!.length / 2)}61${u16(offsets[i]!)}5f39` +
    `61${u16(payloads[i]!.length / 2)}5ff3`;
  const logic =
    "5f3560e01c" +
    answers.map(([sel], i) => `8063${sel.slice(2)}1461${u16(26 + 11 * k + 14 * i)}57`).join("") +
    "365f5f3734365fa1" +
    returns(0) +
    answers.map((_, i) => `5b${returns(i + 1)}`).join("");
  if (logic.length / 2 !== logicLength) throw new Error("recorder layout is off");

  return `0x${logic}${payloads.join("")}` as Hex;
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

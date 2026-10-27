/**
 * `@eco-incorp/sauce/testing`: run Sauce programs on a local chain from a test.
 *
 *   import { describe, it, before, after } from "node:test";
 *   import { fork } from "@eco-incorp/sauce/testing";
 *
 *   const base = await fork("base", { block: 36_000_000, state: "test/state/swap.json.gz", rpcUrl });
 *   await base.fund(base.account(0).pot, { USDC: "100" });
 *   const result = await base.run("swap.sauce.ts", { args: [100_000_000n, 0n, base.account(0).address] });
 *
 *   const solana = await fork("solana", { state: "test/state/pay.json.gz", rpcUrl });
 *   await solana.fund(solana.account(0).pot, { USDC: "100" });
 *   await solana.run("pay.sauce.ts", { args: [solana.account(1).address, 400n] });
 *
 * Node.js only. An EVM chain needs Foundry's `anvil` on PATH; Solana runs in LiteSVM, which the
 * project installs (`npm i -D litesvm` at the version the package pins). Reads no environment: the
 * RPC, the block and the state file are arguments.
 */
import { createPublicClient, createTestClient, getAddress, http, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { TestChain } from "./chain.js";
import { startAnvil } from "./node.js";
import { requireChain, type CanonicalChain, type ChainRef } from "./sdk.js";
import { forkSolana, localSolana, type SolanaForkOptions, type SolanaTestChain } from "./solana.js";
import { setUpStack } from "./stack.js";
import { recorded, startForkNode, type ForkMode } from "./state.js";

export { TestChain, DEFAULT_POT_SALT } from "./chain.js";
export type { CookOptions, CookResult, TestAccount } from "./chain.js";
// What a `CookResult`'s `transfers` and `effects` hold, for a signature over them.
export type { Effects, Movement } from "./sdk.js";
export { CookReverted } from "./program.js";
export type { CompiledProgram, ProgramInput, Value } from "./program.js";
export type { ForkMode } from "./state.js";
export { SolanaTestChain } from "./solana.js";
export type {
  SolanaAccount,
  SolanaChange,
  SolanaCookOptions,
  SolanaCookResult,
  SolanaForkOptions,
  SolanaTestAccount,
} from "./solana.js";

/** Solana, by any name the registry knows it by. */
export type SolanaChainRef = "solana" | "sol" | "mainnet-beta" | "solana-mainnet" | 1399811149;

export interface ForkOptions {
  /** The block the fork starts at. Pin it: a test that forks "latest" changes under you. */
  readonly block: number | bigint;
  /**
   * A recorded state file (`.json.gz`), which replay boots from with no RPC. Commit it beside your
   * tests. With no file there yet, the fork records one (and needs `rpcUrl`).
   */
  readonly state?: string;
  /** The chain's RPC, to record or to fork live: an http(s) URL, which may carry credentials
   *  (`https://user:pass@…`, sent as a Basic header). It must serve state at `block` (an archive
   *  node, for a block that is not recent). */
  readonly rpcUrl?: string;
  /**
   * "auto" (default): replay `state` when it exists, record it when it does not, fork live when no
   * state file is named. "replay" refuses to start without the file; "record" records it again;
   * "live" forks without recording.
   */
  readonly mode?: "auto" | ForkMode;
  /** Seconds between blocks after the pinned one. Default: 12 on Ethereum, 2 elsewhere. */
  readonly blockInterval?: number;
  /** Clear the Kitchen's execution fee, so cooks need no value. Default: keep the chain's fee. */
  readonly zeroFee?: boolean;
  /** The anvil binary. Default: `anvil` on PATH. */
  readonly anvil?: string;
}

function forkMode(options: Pick<ForkOptions, "state" | "rpcUrl" | "mode">): ForkMode {
  const mode = options.mode ?? "auto";
  if (
    mode === "replay" ||
    (mode === "auto" && options.state !== undefined && recorded(options.state))
  ) {
    if (options.state === undefined || !recorded(options.state)) {
      throw new Error(`replay needs a recorded state file: ${options.state ?? "none was named"}`);
    }
    return "replay";
  }
  const chosen: ForkMode =
    mode === "auto" ? (options.state === undefined ? "live" : "record") : mode;
  if (chosen === "record" && options.state === undefined) {
    throw new Error("recording needs `state`, the file to write");
  }
  if (options.rpcUrl === undefined) {
    throw new Error(
      chosen === "record"
        ? `no recorded state at ${options.state}: pass \`rpcUrl\` once to record it`
        : "a live fork needs `rpcUrl`",
    );
  }

  return chosen;
}

const owner = (): Address =>
  getAddress(
    mnemonicToAccount("test test test test test test test test test test test junk").address,
  );

async function ready(
  chain: CanonicalChain,
  url: string,
  mode: TestChain["mode"],
  stop: () => Promise<void>,
  zeroFee: boolean | undefined,
): Promise<TestChain> {
  try {
    const transport = http(url);
    const client = createPublicClient({ transport });
    const test = createTestClient({ mode: "anvil", transport });
    const stack = await setUpStack(url, client, test, owner(), { zeroFee: zeroFee ?? false });
    const testChain = new TestChain(chain, url, mode, stack, stop);
    await testChain.deployPot(0);

    return testChain;
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Forks Solana in LiteSVM, ready to cook: the released engine and Kitchen, ten test accounts each
 * holding 1,000 SOL, account 0's Pot created. Every account a test names is read when it is first
 * named: from the cluster (recording it), or from a recorded state file. Stop it with `stop()`; a
 * recording is written then.
 */
export function fork(chain: SolanaChainRef, options: SolanaForkOptions): Promise<SolanaTestChain>;
/**
 * Forks `chain` at `options.block` on a local anvil, ready to cook: the released stack (the chain's
 * own, or deployed), and anvil's dev accounts as test accounts, account 0's Pot deployed. Replays a
 * recorded state file, records one, or forks live (see {@link ForkOptions.mode}). Stop it with
 * `stop()`; a recording is written then.
 */
export function fork(chain: ChainRef, options: ForkOptions): Promise<TestChain>;
export async function fork(
  chain: ChainRef,
  options: ForkOptions | SolanaForkOptions,
): Promise<TestChain | SolanaTestChain> {
  const resolved = requireChain(chain);
  const mode = forkMode(options);
  if (resolved.kind === "svm") {
    if ("block" in options) {
      throw new Error(
        "a Solana fork takes no `block`: a Solana node serves accounts only as they are now, so a " +
          "recording keeps the slot it read at",
      );
    }
    return forkSolana(resolved, mode, options);
  }
  if (!("block" in options)) {
    throw new Error(`forking ${resolved.slug} needs \`block\`, the block it starts at`);
  }
  // Recording and a live fork both read the endpoint through the kit's proxy, which speaks HTTP.
  if (options.rpcUrl !== undefined && mode !== "replay" && !/^https?:\/\//i.test(options.rpcUrl)) {
    throw new Error(
      `${mode === "live" ? "a live fork" : "recording"} needs an http(s) endpoint as \`rpcUrl\`, ` +
        "not a WebSocket one",
    );
  }
  const node = await startForkNode({
    chainId: resolved.id,
    block: Number(options.block),
    blockInterval: options.blockInterval ?? (resolved.id === 1 ? 12 : 2),
    mode,
    ...(options.rpcUrl === undefined ? {} : { rpcUrl: options.rpcUrl }),
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.anvil === undefined ? {} : { anvil: options.anvil }),
  });

  return ready(resolved, node.url, mode, () => node.stop(), options.zeroFee);
}

export interface LocalOptions {
  /** The chain the empty node runs as: its id, and the names programs compile with. Default Base. */
  readonly chain?: ChainRef;
  readonly anvil?: string;
}

/**
 * An empty Solana chain in LiteSVM — no programs but the runtime's own, no tokens but wrapped SOL —
 * with the released engine and Kitchen at their program ids and no Kitchen fee. For programs that
 * need nothing deployed; fork Solana for anything that calls a program or moves a token.
 */
export function local(options: { readonly chain: SolanaChainRef }): Promise<SolanaTestChain>;
/**
 * An empty local chain — no protocols, no tokens — with the released stack deployed at its release
 * addresses and no Kitchen fee, running as `options.chain` (Base by default). For programs that
 * need nothing deployed; fork a chain for anything that calls a protocol.
 */
export function local(options?: LocalOptions): Promise<TestChain>;
export async function local(options: LocalOptions = {}): Promise<TestChain | SolanaTestChain> {
  const chain = requireChain(options.chain ?? "base");
  if (chain.kind === "svm") return localSolana(chain);
  const node = await startAnvil(
    ["--chain-id", String(chain.id), "--gas-limit", "100000000"],
    options.anvil === undefined ? {} : { binary: options.anvil },
  );

  return ready(chain, node.url, "local", () => node.stop(), true);
}

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
 * Node.js only; needs Foundry's `anvil` on PATH. Reads no environment: the RPC, the block and the
 * state file are arguments.
 */
import { createPublicClient, createTestClient, getAddress, http, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { TestChain } from "./chain.js";
import { startAnvil } from "./node.js";
import { requireChain, type CanonicalChain, type ChainRef } from "./sdk.js";
import { setUpStack } from "./stack.js";
import { recorded, startForkNode, type ForkMode } from "./state.js";

export { TestChain, DEFAULT_POT_SALT } from "./chain.js";
export type { CookOptions, CookResult, TestAccount } from "./chain.js";
export { CookReverted } from "./program.js";
export type { CompiledProgram, ProgramInput, Value } from "./program.js";
export type { ForkMode } from "./state.js";

export interface ForkOptions {
  /** The block the fork starts at. Pin it: a test that forks "latest" changes under you. */
  readonly block: number | bigint;
  /**
   * A recorded state file (`.json.gz`), which replay boots from with no RPC. Commit it beside your
   * tests. With no file there yet, the fork records one (and needs `rpcUrl`).
   */
  readonly state?: string;
  /** The chain's RPC, to record or to fork live. It must serve state at `block` (an archive node,
   *  for a block that is not recent). */
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

function evmChain(ref: ChainRef): CanonicalChain {
  const chain = requireChain(ref);
  if (chain.kind !== "evm") {
    throw new Error(`${chain.slug} is not an EVM chain: the testing kit runs EVM chains only`);
  }

  return chain;
}

function forkMode(options: ForkOptions): ForkMode {
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
 * Forks `chain` at `options.block` on a local anvil, ready to cook: the released stack (the chain's
 * own, or deployed), and anvil's dev accounts as test accounts, account 0's Pot deployed. Replays a
 * recorded state file, records one, or forks live (see {@link ForkOptions.mode}). Stop it with
 * `stop()`; a recording is written then.
 */
export async function fork(chain: ChainRef, options: ForkOptions): Promise<TestChain> {
  const resolved = evmChain(chain);
  const mode = forkMode(options);
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
 * An empty local chain — no protocols, no tokens — with the released stack deployed at its release
 * addresses and no Kitchen fee, running as `options.chain` (Base by default). For programs that
 * need nothing deployed; fork a chain for anything that calls a protocol.
 */
export async function local(options: LocalOptions = {}): Promise<TestChain> {
  const chain = evmChain(options.chain ?? "base");
  const node = await startAnvil(
    ["--chain-id", String(chain.id), "--gas-limit", "100000000"],
    options.anvil === undefined ? {} : { binary: options.anvil },
  );

  return ready(chain, node.url, "local", () => node.stop(), true);
}

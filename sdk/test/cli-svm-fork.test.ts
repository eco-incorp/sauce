/**
 * The local copy a Solana rehearsal runs in (`cli/svm-fork.ts`), against a cluster that is a fake
 * RPC counting what it is asked: a snapshot shared between copies reads each account, the slot and
 * the time once, so the rehearsals that share it (`sauce_simulate`'s scenarios) see one state.
 */
import { address, type Address } from "@solana/kit";

import { forkSnapshot, openFork } from "../src/cli/svm-fork.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";

/** A cluster holding nothing, at `slot`, that counts each request by method. */
function cluster(slot: bigint) {
  const asked: Record<string, number> = {};
  const count = (method: string) => (asked[method] = (asked[method] ?? 0) + 1);
  const rpc = {
    getMultipleAccounts: (keys: readonly Address[]) => ({
      send: async () => (count("getMultipleAccounts"), { value: keys.map(() => null) }),
    }),
    getSlot: () => ({ send: async () => (count("getSlot"), slot) }),
    getBlockTime: () => ({ send: async () => (count("getBlockTime"), 1_790_000_000n) }),
  };

  return { rpc: rpc as never, asked };
}

const ask = <T>(_what: string, request: () => Promise<T>): Promise<T> => request();
const engine = address(v12SvmEngineProgramId());
const kitchen = address(v12SvmKitchenProgramId());
const A = address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const B = address("4uQeVj5tqViQh7yWWGStvkEG1Zmhx74ER8qyvN8hQbVw");

describe("a local copy of the cluster", () => {
  it("reads every account, the slot and the time once for every copy of one snapshot", async () => {
    const { rpc, asked } = cluster(400n);
    const snapshot = forkSnapshot();
    const first = await openFork(rpc, ask, [A], engine, kitchen, "mainnet", snapshot);
    expect(asked).toEqual({ getMultipleAccounts: 1, getSlot: 1, getBlockTime: 1 });
    const second = await openFork(rpc, ask, [A], engine, kitchen, "mainnet", snapshot);
    expect(asked).toEqual({ getMultipleAccounts: 1, getSlot: 1, getBlockTime: 1 });
    expect([first.slot, second.slot]).toEqual([400n, 400n]);
    // An account the snapshot does not hold yet is read, and only it.
    await openFork(rpc, ask, [A, B], engine, kitchen, "mainnet", snapshot);
    expect(asked.getMultipleAccounts).toBe(2);
    expect(asked.getSlot).toBe(1);
  });

  it("reads them again for a copy with no snapshot of its own", async () => {
    const { rpc, asked } = cluster(400n);
    await openFork(rpc, ask, [A], engine, kitchen, "mainnet");
    await openFork(rpc, ask, [A], engine, kitchen, "devnet");
    expect(asked).toEqual({ getMultipleAccounts: 2, getSlot: 2, getBlockTime: 2 });
  });
});

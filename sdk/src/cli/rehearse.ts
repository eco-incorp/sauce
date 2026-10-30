/**
 * Rehearse an authenticated, already deployed Pot without signing or sending.
 * eth_simulateV1 carries the owner's preceding transfers into the cook; the eth_call fallback
 * runs only the cook and reports any preceding transactions it could not simulate.
 * Balance assumptions remain simulation-only; no Pot code, nonce or Router storage is fabricated.
 */
import { getAddress, type Address, type Hex, type PublicClient, type StateOverride } from "viem";

import { CliError } from "./args.js";
import { requireReleasePot, revertReason, type TxRequest } from "./chain.js";
import { resolveChain } from "../chains/canonical.js";
import type { RawLog } from "../evm/effects.js";

export type RehearsalPath = "eth_simulateV1" | "eth_call";

export interface RehearsalInput {
  readonly owner: Address;
  readonly pot: Address;
  /** Counterfactual execution is explicitly refused; deployment is a separate verified operation. */
  readonly deploy?: { readonly salt: Hex };
  /** Owner transactions before the cook: approvals and transfers from `sauce run --fund`.
   * Each must answer as SafeERC20 accepts, nothing or `true`. */
  readonly before?: ReadonlyArray<{ readonly what: string; readonly tx: TxRequest }>;
  readonly cook: TxRequest;
  /** Applied before anything runs. One entry per address (`mergeOverrides`). */
  readonly overrides: StateOverride;
}

interface Base {
  readonly path: RehearsalPath;
  /** Why `eth_simulateV1` did not run, when the fallback did. */
  readonly fallback?: string;
  readonly notes: readonly string[];
}

export type Rehearsal = Base &
  (
    | {
        readonly ok: true;
        readonly returns: Hex;
        /** Gas the cook used (`eth_simulateV1`) or needs (`eth_estimateGas`); `undefined` when the
         *  endpoint could not say. */
        readonly gas?: bigint;
        /** The same for each of `before`'s transactions, in order; empty where they did not run. */
        readonly beforeGas: readonly bigint[];
        readonly gasKind: "used" | "estimated";
        /** The cook's logs (`eth_simulateV1` only). */
        readonly logs?: readonly RawLog[];
        /** Whether the node reported native transfers among them. */
        readonly traced: boolean;
      }
    | {
        readonly ok: false;
        readonly stage: "deploy" | "before" | "cook";
        /** Which of `before`'s transactions failed, when one did. */
        readonly what?: string;
        readonly reason: string;
      }
  );

/** Why a simulated call failed, from the data it reverted with. */
const failedWith = (data: Hex | undefined): string =>
  data === undefined || data === "0x"
    ? "it reverted with no data (out of gas, or a revert with no reason)"
    : revertReason({ data });

/** viem's one line for a failed request, never its details (which repeat the URL). */
const shortReason = (error: unknown): string =>
  (error as { shortMessage?: string }).shortMessage ?? "the request failed";

async function viaSimulateV1(client: PublicClient, input: RehearsalInput): Promise<Rehearsal> {
  const before = input.before ?? [];
  const [block] = await client.simulateBlocks({
    blocks: [
      {
        calls: [
          ...before.map((each) => ({ account: input.owner, ...each.tx })),
          { account: input.owner, ...input.cook },
        ],
        ...(input.overrides.length === 0 ? {} : { stateOverrides: input.overrides }),
      },
    ],
    traceTransfers: true,
    validation: false,
  });
  const results = block?.calls ?? [];
  const base = { path: "eth_simulateV1" as const, notes: [] };
  for (const [index, each] of before.entries()) {
    const result = results[index];
    if (result?.status !== "success") {
      return {
        ...base,
        ok: false,
        stage: "before",
        what: each.what,
        reason: failedWith(result?.data),
      };
    }
    // SafeERC20 on the client's side: nothing, or a word equal to 1.
    if (result.data !== "0x" && BigInt(result.data.slice(0, 66)) !== 1n) {
      return {
        ...base,
        ok: false,
        stage: "before",
        what: each.what,
        reason: "the token answered false: it refuses it",
      };
    }
  }
  const cook = results[before.length];
  if (cook === undefined)
    throw new CliError("the endpoint's eth_simulateV1 answered no result for the cook");
  if (cook.status !== "success") {
    return { ...base, ok: false, stage: "cook", reason: failedWith(cook.data) };
  }
  const logs = (cook.logs ?? []).map((log) => ({
    address: getAddress(log.address),
    topics: log.topics as readonly Hex[],
    data: log.data,
  }));

  return {
    ...base,
    ok: true,
    returns: cook.data,
    gas: cook.gasUsed,
    beforeGas: before.map((_, index) => results[index]!.gasUsed),
    gasKind: "used",
    logs,
    // A cook that carries value moves it to the Pot, so a node that traces transfers reports at
    // least that one; none at all means it did not trace them.
    traced: input.cook.value === 0n || logs.some((log) => log.address === NATIVE_EMITTER),
  };
}

/** Where `traceTransfers` reports native-currency transfers. */
const NATIVE_EMITTER = getAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");

async function viaEthCall(
  client: PublicClient,
  input: RehearsalInput,
  fallback: string | undefined,
): Promise<Rehearsal> {
  const base = { path: "eth_call" as const, ...(fallback === undefined ? {} : { fallback }) };
  // One call cannot carry state to the next: what `sauce run` sends first is not run here.
  const unrun = (input.before ?? []).map((each) => each.what);
  const skipped =
    unrun.length === 0
      ? []
      : [
          `the endpoint does not serve eth_simulateV1, so what sauce run sends before the cook ` +
            `(${unrun.join("; ")}) is not simulated: the cook runs without it`,
        ];
  const request = {
    account: input.owner,
    ...input.cook,
    ...(input.overrides.length === 0 ? {} : { stateOverride: input.overrides }),
  };
  let returns: Hex;
  try {
    returns = (await client.call(request)).data ?? "0x";
  } catch (error) {
    return { ...base, notes: skipped, ok: false, stage: "cook", reason: revertReason(error) };
  }
  const notes = [
    ...skipped,
    "eth_call returns no logs, so what the cook moved is not shown: an endpoint that serves " +
      "eth_simulateV1 shows it",
  ];
  let gas: bigint | undefined;
  try {
    gas = await client.estimateGas(request);
  } catch (error) {
    notes.push(`gas: the endpoint did not estimate it (${shortReason(error)})`);
  }

  return {
    ...base,
    notes,
    ok: true,
    returns,
    ...(gas === undefined ? {} : { gas }),
    beforeGas: [],
    gasKind: "estimated",
    traced: false,
  };
}

/** Rehearses the cook: through `eth_simulateV1` where the endpoint serves it, else `eth_call`. */
export async function rehearse(client: PublicClient, input: RehearsalInput): Promise<Rehearsal> {
  if (input.deploy !== undefined) {
    return {
      path: "eth_call",
      notes: [],
      ok: false,
      stage: "deploy",
      reason:
        "Explicitly deploy, verify and persist the CREATE3 Pot before funding or cooking; rehearsal does not authorize counterfactual code",
    };
  }
  const chain = resolveChain(await client.getChainId());
  if (chain === undefined) throw new CliError("Unknown rehearsal chain");
  await requireReleasePot(client, chain, input.pot);
  try {
    return await viaSimulateV1(client, input);
  } catch (error) {
    if (error instanceof CliError) throw error;

    const why = shortReason(error).replace(/\.$/, "");

    return viaEthCall(client, input, `the endpoint did not run eth_simulateV1: ${why}`);
  }
}

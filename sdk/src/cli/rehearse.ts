/**
 * `sauce simulate`'s rehearsal of a cook: sent from the Pot's owner, on the chain as it is plus the
 * state overrides the command asks for, with nothing signed or sent — and, for a Pot not deployed
 * yet, with its deployment rehearsed first. Two routes, in order:
 *
 *   1. `eth_simulateV1`: one simulated block holding `Kitchen.deployPot(owner, salt)` (when the Pot
 *      is missing; anyone may send it), then the approvals and transfers `sauce run` would send
 *      first (`before`), then the cook from the owner, state carried from one call to the next. It
 *      returns the cook's logs, and with `traceTransfers` its native transfers.
 *   2. `eth_call`, where the endpoint does not serve `eth_simulateV1`. A missing Pot is put in place
 *      first, as the deployment would leave it: an `eth_call` CREATION runs a probe whose
 *      constructor calls the real `Kitchen.deployPot` and returns the Pot that made — its address,
 *      its Router and its runtime code, immutables (owner, salt, Kitchen) included. The cook is then
 *      an `eth_call` from the owner to the Pot with that code, the Router's storage word and the
 *      nonce of a new contract (1) set at the Pot's address by state override: the transaction a
 *      real cook sends, on the state a real deployment leaves. The engine's gate re-derives the
 *      Pot's address from its Kitchen, owner and salt, all genuine. No code is put at the owner, so
 *      `msg.sender` and `tx.origin` are the owner's own. A logs-free route: it reports the result and
 *      the gas, not what the cook moved, and it cannot run `before`'s transactions ahead of the cook.
 */
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

import { sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import { v12Kitchen } from "../evm/engine.js";
import { CliError } from "./args.js";
import { mergeOverrides } from "../evm/balance-slot.js";
import { revertReason, type TxRequest } from "./chain.js";
import { probeDeployment, type ProbedPot } from "./pot-probe.js";
import type { RawLog } from "../evm/effects.js";

export type RehearsalPath = "eth_simulateV1" | "eth_call";

export interface RehearsalInput {
  readonly owner: Address;
  readonly pot: Address;
  /** The released Kitchen, which deploys the Pot. */
  readonly kitchen: Address;
  /** The Pot's salt, when it is not deployed: the rehearsal deploys it first. */
  readonly deploy?: { readonly salt: Hex };
  /** Transactions the owner sends after the deployment and before the cook, each its own: the
   *  ERC-20 approvals and transfers `sauce run --fund` sends first. Each must answer as SafeERC20
   *  accepts, nothing or `true`. */
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
        /** The same for `Kitchen.deployPot`, its own transaction, when the rehearsal deploys the
         *  Pot first. */
        readonly deployGas?: bigint;
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

/** The Pot's one storage word, its Router: ERC-7201 `sauce.storage.Pot` (`Pot.sol`). */
export const POT_ROUTER_SLOT = numberToHex(
  hexToBigInt(
    keccak256(
      pad(numberToHex(hexToBigInt(keccak256(toHex("sauce.storage.Pot"))) - 1n), { size: 32 }),
    ),
  ) & ~0xffn,
  { size: 32 },
);

const POT = parseAbi([
  "function router() view returns (address)",
  "function owner() view returns (address)",
]);

/** The fewest gas a cook can take over its intrinsic cost: the Pot's dispatch, the Kitchen's fee
 *  read and the engine's delegatecall, cold. An estimate below it ran on no Pot code. */
const COOK_FLOOR = 5_000n;

const intrinsicGas = (data: Hex): bigint => {
  let gas = 21_000n;
  for (let at = 2; at < data.length; at += 2) gas += data.slice(at, at + 2) === "00" ? 4n : 16n;

  return gas;
};

/** Why a simulated call failed, from the data it reverted with. */
const failedWith = (data: Hex | undefined): string =>
  data === undefined || data === "0x"
    ? "it reverted with no data (out of gas, or a revert with no reason)"
    : revertReason({ data });

/** viem's one line for a failed request, never its details (which repeat the URL). */
const shortReason = (error: unknown): string =>
  (error as { shortMessage?: string }).shortMessage ?? "the request failed";

async function viaSimulateV1(client: PublicClient, input: RehearsalInput): Promise<Rehearsal> {
  const deploy =
    input.deploy === undefined
      ? []
      : [
          {
            account: input.owner,
            to: input.kitchen,
            data: sauceEvmDeployPotCall({
              kitchen: input.kitchen,
              owner: input.owner,
              salt: input.deploy.salt,
            }).data,
          },
        ];
  // A successful deployment call can still create another release's Pot. Read the predicted
  // Pot in the same simulated state before funding or cooking it: a call to no code "succeeds".
  const verify =
    input.deploy === undefined
      ? []
      : [
          {
            account: input.owner,
            to: input.pot,
            data: encodeFunctionData({ abi: POT, functionName: "owner" }),
          },
        ];
  const offset = deploy.length + verify.length;
  const before = input.before ?? [];
  const [block] = await client.simulateBlocks({
    blocks: [
      {
        calls: [
          ...deploy,
          ...verify,
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
  if (input.deploy !== undefined && results[0]?.status !== "success") {
    return {
      ...base,
      ok: false,
      stage: "deploy",
      reason: failedWith(results[0]?.data),
    };
  }
  if (
    input.deploy !== undefined &&
    (results[0]?.data.toLowerCase() !== pad(input.pot, { size: 32 }).toLowerCase() ||
      results[1]?.status !== "success" ||
      results[1]?.data.toLowerCase() !== pad(input.owner, { size: 32 }).toLowerCase())
  ) {
    return {
      ...base,
      ok: false,
      stage: "deploy",
      reason: `Kitchen.deployPot did not leave the predicted Pot ${input.pot} owned by ${input.owner}`,
    };
  }
  for (const [index, each] of before.entries()) {
    const result = results[offset + index];
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
  const cook = results[offset + before.length];
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
    ...(input.deploy === undefined ? {} : { deployGas: results[0]!.gasUsed }),
    beforeGas: before.map((_, index) => results[offset + index]!.gasUsed),
    gasKind: "used",
    logs,
    // A cook that carries value moves it to the Pot, so a node that traces transfers reports at
    // least that one; none at all means it did not trace them.
    traced: input.cook.value === 0n || logs.some((log) => log.address === NATIVE_EMITTER),
  };
}

/** Where `traceTransfers` reports native-currency transfers. */
const NATIVE_EMITTER = getAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");

/**
 * The Pot `Kitchen.deployPot(owner, salt)` would deploy, as an `eth_call` creation of the probe
 * (`pot-probe.ts`) finds it — its address, Router and runtime code — or the deploy's revert reason.
 */
export async function probePot(
  client: PublicClient,
  kitchen: Address,
  owner: Address,
  salt: Hex,
): Promise<ProbedPot | { readonly reason: string }> {
  try {
    return await probeDeployment(client, {
      kitchen,
      from: owner,
      data: v12Kitchen.encodeDeployPot(owner, salt),
    });
  } catch (error) {
    if (error instanceof CliError) throw error;

    return { reason: revertReason(error) };
  }
}

/**
 * The state override that puts a not-yet-deployed Pot in place exactly as `Kitchen.deployPot` would
 * leave it — or the deploy's revert reason.
 */
async function placePot(
  client: PublicClient,
  input: RehearsalInput & { readonly deploy: { readonly salt: Hex } },
): Promise<StateOverride[number] | { readonly reason: string }> {
  const probed = await probePot(client, input.kitchen, input.owner, input.deploy.salt);
  if ("reason" in probed) return probed;
  const { pot, router, code } = probed;
  if (pot !== getAddress(input.pot)) {
    throw new CliError(`Kitchen.deployPot made ${pot}, not the predicted Pot ${input.pot}`);
  }
  const placed = {
    address: pot,
    code,
    // A contract starts at nonce 1 (EIP-161): a CREATE from the Pot lands where it would for real.
    nonce: 1,
    stateDiff: [{ slot: POT_ROUTER_SLOT, value: pad(router, { size: 32 }) }],
  };
  // The Pot, read back through the override, must be the one deployed: its Router where the
  // constructor stored it and its owner in its code. An endpoint that ignores overrides fails here.
  const overrides = mergeOverrides([...input.overrides, placed]);
  const read = async (functionName: "router" | "owner"): Promise<Address | undefined> => {
    try {
      const { data } = await client.call({
        to: pot,
        data: encodeFunctionData({ abi: POT, functionName }),
        stateOverride: overrides,
      });

      return data === undefined
        ? undefined
        : decodeFunctionResult({ abi: POT, functionName, data });
    } catch {
      return undefined;
    }
  };
  if ((await read("router")) !== router || (await read("owner")) !== getAddress(input.owner)) {
    throw new CliError(
      `the endpoint serves neither eth_simulateV1 nor state overrides on eth_call, so it cannot ` +
        `simulate a cook on a Pot that is not deployed: use an endpoint that serves either, or deploy ` +
        "the Pot first",
    );
  }

  return placed;
}

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
  let overrides = input.overrides;
  if (input.deploy !== undefined) {
    const placed = await placePot(client, { ...input, deploy: input.deploy });
    if ("reason" in placed) {
      return { ...base, notes: skipped, ok: false, stage: "deploy", reason: placed.reason };
    }
    overrides = mergeOverrides([...overrides, placed]);
  }
  const request = {
    account: input.owner,
    ...input.cook,
    ...(overrides.length === 0 ? {} : { stateOverride: overrides }),
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
  // The deploy is its own transaction, estimated on the chain as it is, before the Pot exists.
  let deployGas: bigint | undefined;
  if (input.deploy !== undefined) {
    try {
      deployGas = await client.estimateGas({
        account: input.owner,
        to: input.kitchen,
        data: sauceEvmDeployPotCall({
          kitchen: input.kitchen,
          owner: input.owner,
          salt: input.deploy.salt,
        }).data,
        ...(input.overrides.length === 0 ? {} : { stateOverride: input.overrides }),
      });
    } catch (error) {
      notes.push(`gas: the endpoint did not estimate the Pot's deploy (${shortReason(error)})`);
    }
  }
  try {
    const estimate = await client.estimateGas(request);
    // A node that drops estimateGas's overrides estimates a call to an address with no code.
    if (input.deploy !== undefined && estimate < intrinsicGas(input.cook.data) + COOK_FLOOR) {
      notes.push(
        "gas: the endpoint ignores state overrides in eth_estimateGas, so it is not known",
      );
    } else {
      gas = estimate;
    }
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
    ...(deployGas === undefined ? {} : { deployGas }),
    gasKind: "estimated",
    traced: false,
  };
}

/** Rehearses the cook: through `eth_simulateV1` where the endpoint serves it, else `eth_call`. */
export async function rehearse(client: PublicClient, input: RehearsalInput): Promise<Rehearsal> {
  try {
    return await viaSimulateV1(client, input);
  } catch (error) {
    if (error instanceof CliError) throw error;

    const why = shortReason(error).replace(/\.$/, "");

    return viaEthCall(client, input, `the endpoint did not run eth_simulateV1: ${why}`);
  }
}

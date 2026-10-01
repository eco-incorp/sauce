/**
 * `sauce simulate`'s rehearsal of a cook: sent from the Pot's owner, on the chain as it is plus the
 * state overrides the command asks for, with nothing signed or sent — and, for a Pot not deployed
 * yet, with its deployment rehearsed first. Two routes, in order:
 *
 *   1. `eth_simulateV1`: one simulated block holding `Kitchen.deployPot(owner, salt)` (when the Pot
 *      is missing; anyone may send it) and then the cook from the owner, state carried from one call
 *      to the next. It returns the cook's logs, and with `traceTransfers` its native transfers.
 *   2. `eth_call`, where the endpoint does not serve `eth_simulateV1`. A missing Pot is put in place
 *      first, as the deployment would leave it: an `eth_call` CREATION runs a probe whose
 *      constructor calls the real `Kitchen.deployPot` and returns the Pot that made — its address,
 *      its Router and its runtime code, immutables (owner, salt, Kitchen) included. The cook is then
 *      an `eth_call` from the owner to the Pot with that code, the Router's storage word and the
 *      nonce of a new contract (1) set at the Pot's address by state override: the transaction a
 *      real cook sends, on the state a real deployment leaves. The engine's gate re-derives the
 *      Pot's address from its Kitchen, owner and salt, all genuine. No code is put at the owner, so
 *      `msg.sender` and `tx.origin` are the owner's own. A logs-free route: it reports the result and
 *      the gas, not what the cook moved.
 */
import {
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  sliceHex,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

import { sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import { CliError } from "./args.js";
import { mergeOverrides } from "./assume.js";
import { revertReason, type TxRequest } from "./chain.js";
import type { RawLog } from "./effects.js";

export type RehearsalPath = "eth_simulateV1" | "eth_call";

export interface RehearsalInput {
  readonly owner: Address;
  readonly pot: Address;
  /** The released Kitchen, which deploys the Pot. */
  readonly kitchen: Address;
  /** The Pot's salt, when it is not deployed: the rehearsal deploys it first. */
  readonly deploy?: { readonly salt: Hex };
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
        readonly gasKind: "used" | "estimated";
        /** The cook's logs (`eth_simulateV1` only). */
        readonly logs?: readonly RawLog[];
        /** Whether the node reported native transfers among them. */
        readonly traced: boolean;
      }
    | { readonly ok: false; readonly stage: "deploy" | "cook"; readonly reason: string }
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

/**
 * The probe's init code, followed by `kitchen`, `owner` and `salt` (32 bytes each). Its constructor:
 *
 *   mem[0..0x44]  = deployPot(owner, salt)        PUSH4 ff9763ac … MSTORE; CODECOPY the two words
 *   mem[0xa0]     = Kitchen.deployPot(…)          CALL, bubbling a revert
 *   mem[0xc0]     = pot.router()                  STATICCALL, bubbling a revert
 *   mem[0xe0..]   = pot's runtime code            EXTCODECOPY
 *   RETURN mem[0xa0 .. 0xe0 + size]               pot, router, code
 *
 * An `eth_call` creation answers with what the constructor returns, so the answer is the Pot that
 * `Kitchen.deployPot` deploys. Its first byte is a zero (the Pot's address word), as a creation's
 * return must not start with 0xef.
 */
const POT_PROBE: Hex = `0x${[
  "63ff9763ac60e01b600052", //  PUSH4 deployPot  PUSH1 e0 SHL  PUSH1 0 MSTORE
  "604061008a600439", //        CODECOPY(0x04, 0x8a, 0x40): owner, salt
  "602061006a608039", //        CODECOPY(0x80, 0x6a, 0x20): kitchen
  "602060a06044600060006080515af1", // CALL(gas, kitchen, 0, 0, 0x44, 0xa0, 0x20)
  "1561005f57", //              ISZERO PUSH2 fail JUMPI
  "63f887ea4060e01b600052", //  PUSH4 router  PUSH1 e0 SHL  PUSH1 0 MSTORE
  "602060c06004600060a0515afa", // STATICCALL(gas, pot, 0, 4, 0xc0, 0x20)
  "1561005f57", //              ISZERO PUSH2 fail JUMPI
  "60a0513b80600060e060a0513c", // EXTCODESIZE(pot) DUP1; EXTCODECOPY(pot, 0xe0, 0, size)
  "60400160a0f3", //            RETURN(0xa0, size + 0x40)
  "5b3d600060003e3d6000fd", //  fail: RETURNDATACOPY(0, 0, size) REVERT(0, size)
].join("")}`;

/** `0x6a`: where the probe's arguments start, which its two CODECOPYs name. */
const PROBE_ARGS_AT = 0x6a;

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
  const [block] = await client.simulateBlocks({
    blocks: [
      {
        calls: [...deploy, { account: input.owner, ...input.cook }],
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
  const cook = results[deploy.length];
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
 * finds it — its address, Router and runtime code — or the deploy's revert reason.
 */
export async function probePot(
  client: PublicClient,
  kitchen: Address,
  owner: Address,
  salt: Hex,
): Promise<
  | { readonly pot: Address; readonly router: Address; readonly code: Hex }
  | { readonly reason: string }
> {
  let answer: Hex | undefined;
  try {
    ({ data: answer } = await client.call({
      account: owner,
      data: concat([POT_PROBE, pad(kitchen, { size: 32 }), pad(owner, { size: 32 }), salt]),
    }));
  } catch (error) {
    return { reason: revertReason(error) };
  }
  if (answer === undefined || answer.length < 2 + 64 * 2 + 2) {
    throw new CliError("the endpoint answered the Pot's deployment with no code");
  }

  return {
    pot: getAddress(sliceHex(answer, 12, 32)),
    router: getAddress(sliceHex(answer, 44, 64)),
    code: sliceHex(answer, 64),
  };
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
        `rehearse a cook on a Pot that is not deployed: use an endpoint that serves either, or deploy ` +
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
  let overrides = input.overrides;
  if (input.deploy !== undefined) {
    const placed = await placePot(client, { ...input, deploy: input.deploy });
    if ("reason" in placed) {
      return { ...base, notes: [], ok: false, stage: "deploy", reason: placed.reason };
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
    return { ...base, notes: [], ok: false, stage: "cook", reason: revertReason(error) };
  }
  const notes = [
    "eth_call returns no logs, so what the cook moved is not shown: an endpoint that serves " +
      "eth_simulateV1 shows it",
  ];
  let gas: bigint | undefined;
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

/** The probe's init code and where its arguments start, for the test that pins the assembly. */
export const potProbe = { code: POT_PROBE, argsAt: PROBE_ARGS_AT } as const;

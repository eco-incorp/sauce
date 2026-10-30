import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { getAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";

import { sdkCompilerVersion, v12EngineAddress, v12KitchenAddress } from "../deployments/index.js";
import { verifyPotBinding, type EvmPotBinding, type EvmPotBindingInput } from "../evm/engine.js";
import { v12PredictPot } from "../deployments/pot.js";
import { CliError } from "./args.js";
import { keptPots } from "./keep.js";
import type { PotRecord } from "./pot-store.js";

export type PotCandidate = Omit<
  EvmPotBindingInput,
  "pot" | "owner" | "userSalt" | "kind" | "chainId"
>;
const candidates = new AsyncLocalStorage<PotCandidate>();
const requests = new AsyncLocalStorage<{
  readonly input?: EvmPotBindingInput;
  verified?: EvmPotBinding;
}>();

/** Each request owns its untrusted selection and the proof produced by real chain verification. */
export const withPotBinding = <T>(binding: EvmPotBindingInput | undefined, run: () => T): T =>
  requests.run({ input: binding === undefined ? undefined : structuredClone(binding) }, run);
export const requestedPotBinding = (): EvmPotBindingInput | undefined => requests.getStore()?.input;
export const getVerifiedPotBinding = (): EvmPotBinding | undefined => requests.getStore()?.verified;

/** Explicit operator-selected descriptor, never an implicit SDK default. */
export const withPotCandidate = <T>(candidate: PotCandidate | undefined, run: () => T): T =>
  candidate === undefined ? run() : candidates.run(candidate, run);
export const potCandidate = (): PotCandidate | undefined => candidates.getStore();
export const selectedKitchen = (): Address =>
  getAddress(requestedPotBinding()?.kitchen ?? potCandidate()?.kitchen ?? v12KitchenAddress());

/** The operator supplies this file through --pot-binding; discovery never trusts getter metadata. */
export function readPotCandidate(text: string): PotCandidate {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object")
    throw new CliError("Pot binding descriptor must be an object");
  const candidate = value as Record<string, unknown>;
  for (const field of [
    "compiler",
    "engine",
    "engineCodeHash",
    "router",
    "routerCodeHash",
    "kitchen",
    "wireProfile",
    "storageProfile",
  ]) {
    if (typeof candidate[field] !== "string" || candidate[field] === "") {
      throw new CliError(`Pot binding descriptor is missing ${field}`);
    }
  }
  if (
    candidate.release === null ||
    typeof candidate.release !== "object" ||
    Array.isArray(candidate.release)
  ) {
    throw new CliError("Pot binding descriptor is missing its explicit release");
  }
  const release = candidate.release as Record<string, unknown>;
  if (
    typeof release["v12-evm"] !== "string" ||
    !release["v12-evm"] ||
    typeof release["kitchen-evm"] !== "string" ||
    !release["kitchen-evm"]
  ) {
    throw new CliError("Pot binding descriptor has an incomplete explicit release");
  }
  if (release.compiler !== candidate.compiler) {
    throw new CliError("Pot binding descriptor release must identify the exact compiler");
  }
  if (candidate.profile !== undefined && typeof release.router !== "string") {
    throw new CliError("CREATE3 release descriptor must identify its authenticated release Router");
  }

  return candidate as unknown as PotCandidate;
}

export function storedPot(chainId: number, pot: Address): PotRecord | undefined {
  const records = keptPots()?.recordsOf(chainId, pot) ?? [];

  return records.filter((record) => record.binding !== undefined).at(-1) ?? records[0];
}

export function executionBinding(chainId: number, pot: Address): EvmPotBinding | undefined {
  const verified = getVerifiedPotBinding();
  return verified?.chainId === chainId && getAddress(verified.pot) === getAddress(pot)
    ? verified
    : storedPot(chainId, pot)?.binding;
}

/** Request selection may fill missing provenance, never replace persisted execution pins. */
function requestBinding(chainId: number, pot: Address): EvmPotBindingInput | undefined {
  const input = requestedPotBinding();
  if (input === undefined) return undefined;
  if (input.chainId !== chainId || getAddress(input.pot) !== getAddress(pot)) {
    throw new CliError("Explicit request binding does not match the selected chain/Pot");
  }
  const stored = storedPot(chainId, pot);
  if (
    stored !== undefined &&
    (stored.engine?.toLowerCase() !== input.engine.toLowerCase() ||
      !isDeepStrictEqual(stored.release, input.release) ||
      (stored.binding !== undefined &&
        !isDeepStrictEqual({ ...stored.binding, ...input }, stored.binding)))
  ) {
    throw new CliError(
      "Explicit request binding differs from persisted Pot pins; no automatic repinning is allowed",
    );
  }

  return input;
}

/** Existing owner/salt selections resolve saved addresses before deriving a new candidate. */
export function resolvePotTarget(
  chainId: number,
  target: { readonly pot: Address } | { readonly owner: Address; readonly salt: Hex },
): Address {
  if ("pot" in target) {
    requestBinding(chainId, target.pot);
    return getAddress(target.pot);
  }
  const requested = requestedPotBinding();
  if (requested !== undefined) {
    if (
      requested.chainId !== chainId ||
      getAddress(requested.owner) !== getAddress(target.owner) ||
      requested.userSalt.toLowerCase() !== target.salt.toLowerCase()
    ) {
      throw new CliError("Explicit request binding does not match the selected chain/owner/salt");
    }
    requestBinding(chainId, requested.pot);
    return getAddress(requested.pot);
  }
  const records = keptPots()?.list();
  if (records?.warnings.length) throw new CliError(records.warnings.join("\n"));
  const addresses = new Set(
    (records?.pots ?? [])
      .filter(
        (record) =>
          record.chainId === chainId &&
          record.owner.toLowerCase() === target.owner.toLowerCase() &&
          record.salt.toLowerCase() === target.salt.toLowerCase(),
      )
      .map((record) => getAddress(record.pot)),
  );
  if (addresses.size > 1)
    throw new CliError(
      "Owner and salt name multiple persisted Pots; select the explicit --pot address",
    );

  return [...addresses][0] ?? v12PredictPot(target.owner, target.salt, selectedKitchen());
}

/** Defaults cannot replace a stored engine/compiler, even before a chain read. */
export function executionEngine(chainId: number, pot: Address): Address {
  const stored = storedPot(chainId, pot);
  const requested = requestBinding(chainId, pot);
  const compiler =
    stored?.release?.compiler ??
    requested?.compiler ??
    potCandidate()?.compiler ??
    sdkCompilerVersion();
  if (compiler !== sdkCompilerVersion()) {
    throw new CliError(
      `Pot ${pot} requires pinned compiler ${compiler}; this SDK compiles with ${sdkCompilerVersion()}. Use its paired SDK, not a default replacement`,
    );
  }
  if (
    stored !== undefined &&
    (stored.release?.compiler === undefined || stored.engine === undefined)
  ) {
    throw new CliError(
      `Pot ${pot} has an ambiguous persisted compiler/engine binding; import authenticated provenance first`,
    );
  }

  return getAddress(
    stored?.engine ?? requested?.engine ?? potCandidate()?.engine ?? v12EngineAddress(),
  );
}

export async function verifyRecordedPot(
  client: PublicClient,
  chainId: number,
  pot: Address,
  fallback?: EvmPotBindingInput,
): Promise<EvmPotBinding> {
  const context = requests.getStore();
  if (context !== undefined) context.verified = undefined;
  const record = storedPot(chainId, pot);
  const requested = requestBinding(chainId, pot);
  const input = record?.binding ?? requested ?? fallback;
  if (input === undefined)
    throw new CliError(
      `Pot ${pot} has no authenticated release/profile binding; import its explicit provenance first`,
    );
  if (input.chainId !== chainId || getAddress(input.pot) !== getAddress(pot)) {
    throw new CliError(`Pot ${pot} does not match its persisted chain/address binding`);
  }
  try {
    const binding = await verifyPotBinding(client, input);
    if (context !== undefined) context.verified = binding;
    return binding;
  } catch (error) {
    throw new CliError(
      `Pot ${pot} binding verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function observedCodeHash(client: PublicClient, address: Address): Promise<Hex> {
  const code = await client.getCode({ address });
  if (code === undefined || code === "0x")
    throw new CliError(
      `expected deployed code at ${address}; no implicit deployment or replacement is allowed`,
    );

  return keccak256(code);
}

/**
 * Pinned release addresses and a separate historical chain roster. Address functions and
 * `v12Deployment` read `V12Deployments.json`; chain flags/slugs describe the older roster and
 * require on-chain verification before use. Exported legacy address constants remain for compatibility.
 */
import {
  V12_EVM_CHAINS,
  V12_EVM_CONTRACTS,
  V12_GENERATED_BY,
  V12_SALT,
  V12_SVM,
} from "./v12.generated.js";
import { v12EngineAddress, v12KitchenAddress, v12RouterAddress } from "./v12-addresses.js";

export { V12_EVM_CHAINS, V12_EVM_CONTRACTS, V12_GENERATED_BY, V12_SALT, V12_SVM };

// The pinned release addresses, assembled from each release's addresses.json (see the header split).
export * from "./v12-addresses.js";

/** The pinned release's three chain-invariant EVM contract addresses. */
export interface V12EvmContracts {
  /** Swap surface every Pot's fallback delegatecalls into. */
  router: string;
  /** The Huff interpreter runtime that executes Sauce bytecode. */
  v12Runtime: string;
  /** Factory — mint a Pot via `deployPot(owner, salt)`. */
  v12Kitchen: string;
}

/** One chain's deploy outcome, as recorded by the engine's deploy script. */
export interface V12ChainDeployment {
  chainId: number;
  /** Engine-side chain slug (e.g. `'base'`) — not necessarily the SDK's chain name. */
  name: string;
  /** Historical deployment outcome; does not attest the pinned release's current liveness. */
  live: boolean;
  status: string;
  /** Present only for a failed deploy. */
  error?: string;
}

/** Pinned release addresses for a chain in the historical successful-deployment roster. */
export interface V12Deployment extends V12EvmContracts {
  chainId: number;
  name: string;
}

const CHAINS = V12_EVM_CHAINS as Record<
  number,
  { name: string; live: boolean; status: string; error?: string }
>;

/** Every chain id in the record, live or not, ascending. */
export function v12ChainIds(): number[] {
  return Object.keys(CHAINS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Historically successful chain ids, ascending. Check current release code before use. */
export function v12LiveChainIds(): number[] {
  return v12ChainIds().filter((id) => CHAINS[id].live);
}

/** Chain ids present in the record whose deploy did NOT land. */
export function v12FailedChainIds(): number[] {
  return v12ChainIds().filter((id) => !CHAINS[id].live);
}

/** Historical success flag; not an RPC check or proof that the pinned release is deployed. */
export function isV12Live(chainId: number): boolean {
  return CHAINS[chainId]?.live === true;
}

/** The raw per-chain record (including a failed chain's `error`), or undefined if unknown. */
export function v12ChainDeployment(chainId: number): V12ChainDeployment | undefined {
  const c = CHAINS[chainId];
  return c === undefined ? undefined : { chainId, ...c };
}

/**
 * Engine-side chain slug from a historically successful deployment record. This is not a
 * current release liveness check or an attestation of a routing provider's chain coverage.
 */
export function v12ChainSlug(chainId: number): string | undefined {
  const c = CHAINS[chainId];
  return c === undefined || !c.live ? undefined : c.name;
}

/**
 * Every live v12 chain as a `chainId → slug` map, ascending — the direct
 * replacement for a hand-maintained slug constant. Excludes chains whose deploy
 * did not land (see {@link v12FailedChainIds}).
 */
export function v12LiveChainSlugs(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const id of v12LiveChainIds()) out[id] = CHAINS[id].name;
  return out;
}

/**
 * Pinned release addresses for a historically successful chain, otherwise undefined.
 * The legacy roster does not attest that this release is deployed: verify code on the target chain.
 */
export function v12Deployment(chainId: number): V12Deployment | undefined {
  const c = CHAINS[chainId];
  if (c === undefined || !c.live) return undefined;
  return {
    chainId,
    name: c.name,
    router: v12RouterAddress(),
    v12Runtime: v12EngineAddress(),
    v12Kitchen: v12KitchenAddress(),
  };
}

/** Like {@link v12Deployment}, but throws with the reason instead of returning undefined. */
export function requireV12Deployment(chainId: number): V12Deployment {
  const found = v12Deployment(chainId);
  if (found !== undefined) return found;

  const c = CHAINS[chainId];
  if (c === undefined) {
    throw new Error(
      `Sauce v12 has no historical deployment record for chain ${chainId} (known chains: ${v12ChainIds().join(", ")})`,
    );
  }
  throw new Error(
    `Sauce v12's historical deployment failed on chain ${chainId} (${c.name}): status '${c.status}'` +
      (c.error === undefined ? "" : ` — ${c.error}`),
  );
}

/** @deprecated Legacy engine program id. Use `v12SvmEngineProgramId()` for the pinned release. */
export const v12SvmProgramId: string = V12_SVM.programId;

/** Historical SVM cluster coverage; not an attestation of the pinned release's deployment. */
export function isV12SvmDeployed(cluster: string): boolean {
  return Object.prototype.hasOwnProperty.call(V12_SVM.clusters, cluster);
}

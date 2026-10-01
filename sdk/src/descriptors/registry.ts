import type { Abi } from "viem";
import { getProtocol } from "../protocols/index.js";
import type { ChainDeployment } from "../core/types.js";
import { CONTRACT_LINKS, PROTOCOL_SOURCES } from "./contracts.generated.js";
import type { ContractLink } from "./links.js";
import { buildDescriptor } from "./derive.js";
import type { ContractDescriptor } from "./types.js";
import type { ChainSlug } from "../chains/canonical.js";

/**
 * Every registry protocol's ABI exports, by slug then export name — the arrays each protocol's
 * `abis.ts` exports, read through the generated `PROTOCOL_SOURCES` (`contracts.generated.ts`).
 */
const ABI_EXPORTS: Readonly<Record<string, Readonly<Record<string, Abi>>>> = Object.fromEntries(
  Object.entries(PROTOCOL_SOURCES).map(([slug, source]) => [
    slug,
    Object.fromEntries(
      Object.entries(source.abis as Readonly<Record<string, unknown>>).filter(([, value]) =>
        Array.isArray(value),
      ),
    ) as Record<string, Abi>,
  ]),
);

/** Exposed for the linkage test's fail-closed invariants — not part of the public query API (see query.ts/index.ts). */
export { ABI_EXPORTS };

function resolveAbi(protocol: string, abiExport: string | undefined): Abi | undefined {
  if (abiExport === undefined) return undefined;
  const abi = ABI_EXPORTS[protocol]?.[abiExport];
  if (abi === undefined) {
    throw new Error(
      `descriptors registry: unknown ABI export '${abiExport}' for protocol '${protocol}' — regenerate contracts.generated.ts`,
    );
  }
  return abi;
}

function buildAllDescriptors(): ContractDescriptor[] {
  const out: ContractDescriptor[] = [];
  for (const link of CONTRACT_LINKS as readonly ContractLink[]) {
    const protocolInfo = getProtocol(link.protocol);
    if (protocolInfo === undefined) {
      throw new Error(
        `descriptors registry: unknown protocol '${link.protocol}' in CONTRACT_LINKS — regenerate contracts.generated.ts`,
      );
    }
    const deployments = (
      PROTOCOL_SOURCES as Readonly<Record<string, { deployments: readonly ChainDeployment[] }>>
    )[link.protocol]!.deployments;
    out.push(
      buildDescriptor(link, protocolInfo, resolveAbi(link.protocol, link.abiExport), deployments),
    );
  }
  return out;
}

/** The whole flat registry, built once at module load. Stable order: as declared in CONTRACT_LINKS. */
export const DESCRIPTORS: readonly ContractDescriptor[] = Object.freeze(buildAllDescriptors());

function normalizeKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** protocol slug (normalized) -> its descriptors, in DESCRIPTORS order. */
export const byProtocol: ReadonlyMap<string, readonly ContractDescriptor[]> = (() => {
  const map = new Map<string, ContractDescriptor[]>();
  for (const d of DESCRIPTORS) {
    const key = normalizeKey(d.protocol);
    const list = map.get(key);
    if (list) list.push(d);
    else map.set(key, [d]);
  }
  return map;
})();

/** protocol slug (normalized) -> contract name (normalized) -> descriptor. */
export const byProtocolAndContract: ReadonlyMap<
  string,
  ReadonlyMap<string, ContractDescriptor>
> = (() => {
  const map = new Map<string, Map<string, ContractDescriptor>>();
  for (const d of DESCRIPTORS) {
    const pKey = normalizeKey(d.protocol);
    let inner = map.get(pKey);
    if (!inner) {
      inner = new Map();
      map.set(pKey, inner);
    }
    inner.set(normalizeKey(d.contract), d);
  }
  return map;
})();

/** REVERSE INDEX: chain slug -> descriptors with an address on that chain (kind:"interface" descriptors are always excluded — see listInterfaces). */
export const byChain: ReadonlyMap<ChainSlug, readonly ContractDescriptor[]> = (() => {
  const map = new Map<ChainSlug, ContractDescriptor[]>();
  for (const d of DESCRIPTORS) {
    for (const slug of d.chains) {
      const list = map.get(slug);
      if (list) list.push(d);
      else map.set(slug, [d]);
    }
  }
  return map;
})();

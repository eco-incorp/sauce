/**
 * Fail-closed invariants over the generated contract table (../src/descriptors/contracts.generated.ts)
 * and the registry data behind it. Every assertion here is a drift alarm: an edit to addresses.ts,
 * abis.ts or targets.json that the table no longer agrees with fails the suite, rather than shipping
 * a silent hole. `routes-source-globals.test.ts` holds the table to its generator.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, getAddress } from "viem";
import { CONTRACT_LINKS, type ContractLink } from "../src/descriptors/links.js";
import { PROTOCOL_SOURCES } from "../src/descriptors/contracts.generated.js";
import { ABI_EXPORTS } from "../src/descriptors/registry.js";
import { DESCRIPTORS } from "../src/descriptors/index.js";
import { deriveContractName } from "../src/descriptors/derive.js";
import { getProtocol, listProtocolSlugs } from "../src/protocols/index.js";
import { requireChain, chainByAlias, chainById } from "../src/chains/canonical.js";
import { protocols } from "../src/protocols/index.js";
import type { ChainDeployment } from "../src/core/types.js";

const LINKS: readonly ContractLink[] = CONTRACT_LINKS;

const __dirname = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "registry-abi", "targets.json"), "utf8"),
).protocols as Record<
  string,
  Record<string, { roles?: string[]; chains?: number[]; unverifiable?: string }>
>;

const deploymentsOf = (slug: string): readonly ChainDeployment[] =>
  (PROTOCOL_SOURCES as Record<string, { deployments: readonly ChainDeployment[] }>)[slug]!
    .deployments;

/** Roles with an EVM address on a canonical EVM chain. */
function evmRoles(slug: string): Set<string> {
  const roles = new Set<string>();
  for (const d of deploymentsOf(slug)) {
    if (chainById(d.chainId)?.kind !== "evm") continue;
    for (const [role, address] of Object.entries(d.addresses)) {
      if (/^0x[0-9a-fA-F]{40}$/.test(address)) roles.add(role);
    }
  }
  return roles;
}

describe("descriptor linkage: every link resolves against the live vendored data", () => {
  it("every registry protocol has a namespace, and every link's protocol exists", () => {
    expect(new Set(LINKS.map((l) => l.protocol))).toEqual(new Set(listProtocolSlugs()));
    for (const link of LINKS) expect(getProtocol(link.protocol)).toBeDefined();
  });

  it("every roleKey has an EVM address in its protocol's deployments", () => {
    for (const link of LINKS) {
      if (link.roleKey === undefined) continue;
      expect([link.protocol, evmRoles(link.protocol).has(link.roleKey)]).toEqual([
        link.protocol,
        true,
      ]);
    }
  });

  it("every abiExport is an array-valued export of that protocol's abis.ts", () => {
    for (const link of LINKS) {
      if (link.abiExport === undefined) continue;
      const abi = ABI_EXPORTS[link.protocol]?.[link.abiExport];
      expect(Array.isArray(abi)).toBe(true);
    }
  });
});

describe("descriptor linkage: kind consistency", () => {
  it("singleton implies both roleKey and abiExport are present", () => {
    for (const link of LINKS) {
      if (link.kind !== "singleton") continue;
      expect(link.roleKey).toBeDefined();
      expect(link.abiExport).toBeDefined();
    }
  });

  it("address-only implies roleKey only (no abiExport)", () => {
    for (const link of LINKS) {
      if (link.kind !== "address-only") continue;
      expect(link.roleKey).toBeDefined();
      expect(link.abiExport).toBeUndefined();
    }
  });

  it("interface implies abiExport only (no roleKey), and its binding names no role", () => {
    for (const link of LINKS) {
      if (link.kind !== "interface") continue;
      expect(link.roleKey).toBeUndefined();
      expect(link.abiExport).toBeDefined();
      expect(targets[link.protocol]![link.abiExport!]!.roles ?? []).toEqual([]);
    }
  });
});

describe("descriptor linkage: the table is the evidence binding, all of it", () => {
  it("every EVM role is a contract: bound by its target, or address-only", () => {
    const unlinked: string[] = [];
    for (const slug of listProtocolSlugs()) {
      const linked = new Set(LINKS.filter((l) => l.protocol === slug).map((l) => l.roleKey));
      for (const role of evmRoles(slug)) if (!linked.has(role)) unlinked.push(`${slug}.${role}`);
    }
    expect(unlinked).toEqual([]);
  });

  it("a role is bound exactly as targets.json binds it", () => {
    const wrong: string[] = [];
    for (const link of LINKS) {
      if (link.roleKey === undefined) continue;
      const bound = Object.entries(targets[link.protocol] ?? {}).filter(([, t]) =>
        t.roles?.includes(link.roleKey!),
      );
      const verified = bound.filter(([, t]) => t.unverifiable === undefined);
      if (link.kind === "singleton") {
        const match = verified.find(([name]) => name === link.abiExport);
        if (
          match === undefined ||
          JSON.stringify(match[1].chains) !== JSON.stringify(link.chains)
        ) {
          wrong.push(`${link.protocol}.${link.contract}`);
        }
      } else if (verified.length > 0) {
        wrong.push(`${link.protocol}.${link.contract} is address-only but bound`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every abis.ts export is a contract's ABI, unless its evidence is unverifiable", () => {
    const unclaimed: string[] = [];
    for (const [slug, exports] of Object.entries(ABI_EXPORTS)) {
      const claimed = new Set(LINKS.filter((l) => l.protocol === slug).map((l) => l.abiExport));
      for (const name of Object.keys(exports)) {
        if (claimed.has(name) || targets[slug]?.[name]?.unverifiable !== undefined) continue;
        unclaimed.push(`${slug}.${name}`);
      }
    }
    expect(unclaimed).toEqual([]);
  });
});

describe("descriptor linkage: (protocol, contract) uniqueness and names", () => {
  it("no two descriptors share a (protocol, contract) pair", () => {
    const keys = DESCRIPTORS.map((d) => `${d.protocol}::${d.contract}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a role's contract is its role key, capitalized, in the ABI export's spelling where it has one", () => {
    const split = new Set(
      LINKS.filter((l) => l.chains !== undefined).map((l) => `${l.protocol}::${l.roleKey}`),
    );
    for (const link of LINKS) {
      if (link.roleKey === undefined || split.has(`${link.protocol}::${link.roleKey}`)) continue;
      expect(link.contract.toLowerCase()).toBe(link.roleKey.toLowerCase());
      expect(link.contract[0]).toBe(link.contract[0]!.toUpperCase());
    }
  });

  it("an interface, or a role split across ABIs by chain, is named by deriveContractName", () => {
    for (const link of LINKS) {
      if (link.kind !== "interface" && link.chains === undefined) continue;
      const info = getProtocol(link.protocol)!;
      expect(link.contract).toBe(deriveContractName(info.name, link.abiExport!, link.protocol));
    }
  });

  it("names the motivating contracts as the namespace convention reads", () => {
    const name = (protocol: string, role: string) =>
      LINKS.find((l) => l.protocol === protocol && l.roleKey === role)?.contract;
    expect(name("pancakeswap-v3", "factory")).toBe("Factory");
    expect(name("aerodrome-slipstream", "clFactory")).toBe("CLFactory");
    expect(name("aerodrome-slipstream", "clFactoryGaugeCaps")).toBe("CLFactoryGaugeCaps");
    expect(name("compound-v3", "cUSDCv3")).toBe("CUSDCv3");
    expect(name("trader-joe", "lbRouter")).toBe("LBRouter");
    expect(name("uniswap-v3", "quoterV2")).toBe("QuoterV2");
  });

  it("every linked abiExport has a sibling protocols/<slug>/<Export>.json on disk (needed by toSauceScript's import line)", () => {
    for (const link of LINKS) {
      if (link.abiExport === undefined) continue;
      const jsonPath = join(
        __dirname,
        "..",
        "src",
        "protocols",
        link.protocol,
        `${link.abiExport}.json`,
      );
      expect([jsonPath, existsSync(jsonPath)]).toEqual([jsonPath, true]);
    }
  });
});

describe("descriptor linkage: an overloaded name is unambiguous by argument count", () => {
  // The accessor and `methodOf` pick an overload by how many arguments it takes, and the route
  // rewrite binds a name with `.view` or `.at` before the compiler picks an overload. So overloads
  // of one name must differ in argument count, and be all view or all non-view.
  it("every registry ABI's overloads differ in argument count and agree on view vs non-view", () => {
    const ambiguous: string[] = [];
    for (const d of DESCRIPTORS) {
      const byName = new Map<string, typeof d.methods>();
      for (const m of d.methods) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
      for (const [name, overloads] of byName) {
        if (overloads.length === 1) continue;
        const arities = overloads.map((m) => m.inputs.length);
        const reads = new Set(
          overloads.map((m) => m.stateMutability === "view" || m.stateMutability === "pure"),
        );
        if (new Set(arities).size !== arities.length || reads.size !== 1) {
          ambiguous.push(
            `${d.protocol}.${d.contract}.${name}: ${overloads.map((m) => m.signature).join(", ")}`,
          );
        }
      }
    }
    expect(ambiguous).toEqual([]);
  });
});

describe("descriptor linkage: chain keying via the canonical registry", () => {
  it("every chainId in every registry protocol's deployments resolves via requireChain", () => {
    for (const info of Object.values(protocols)) {
      for (const deployment of info.chains) {
        expect(() => requireChain(deployment.chainId)).not.toThrow();
      }
    }
  });

  it("every chainName string in every registry protocol resolves via chainByAlias back to its own chainId", () => {
    for (const info of Object.values(protocols)) {
      for (const deployment of info.chains) {
        const resolved = chainByAlias(deployment.chainName);
        expect(resolved).toBeDefined();
        expect(resolved!.id).toBe(deployment.chainId);
      }
    }
  });

  it("no protocol has a duplicate chainId across its own deployments", () => {
    for (const info of Object.values(protocols)) {
      const ids = info.chains.map((d) => d.chainId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("descriptor linkage: address checksum invariants", () => {
  it("every perChainAddress value is EIP-55 checksummed and isAddress-valid", () => {
    for (const d of DESCRIPTORS) {
      for (const addr of Object.values(d.perChainAddress)) {
        expect(isAddress(addr)).toBe(true);
        expect(addr).toBe(getAddress(addr));
      }
    }
  });

  it("uniswap-v4.UniversalRouter@8453 (lowercase in the vendored file) comes out checksummed", () => {
    const d = DESCRIPTORS.find(
      (x) => x.protocol === "uniswap-v4" && x.contract === "UniversalRouter",
    )!;
    const addr = d.perChainAddress[8453];
    expect(addr).toBe("0x6fF5693b99212Da76ad316178A184AB56D299b43");
  });

  it("a role split across ABIs by chain keeps each binding to its own chains (gamma's uniProxy)", () => {
    const proxy = DESCRIPTORS.find((d) => d.protocol === "gamma" && d.contract === "UniProxy")!;
    const legacy = DESCRIPTORS.find(
      (d) => d.protocol === "gamma" && d.contract === "UniProxyLegacy",
    )!;
    expect(proxy.chains).toEqual(["polygon"]);
    expect(legacy.chains).toEqual(["ethereum"]);
  });
});

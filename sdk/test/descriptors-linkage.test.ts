/**
 * Fail-closed invariants over the vendored data behind the descriptor
 * linkage table (../src/descriptors/links.ts). Every assertion here is a
 * drift alarm: a future edit to addresses.ts/abis.ts, or to links.ts itself,
 * that breaks one of these should fail the suite, not ship a silent hole.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, getAddress } from "viem";
import { CONTRACT_LINKS, type ContractLink } from "../src/descriptors/links.js";

const LINKS: readonly ContractLink[] = CONTRACT_LINKS;
import { ABI_EXPORTS } from "../src/descriptors/registry.js";
import { DESCRIPTORS } from "../src/descriptors/index.js";
import { deriveContractName } from "../src/descriptors/derive.js";
import { getProtocol } from "../src/protocols/index.js";
import { requireChain, chainByAlias } from "../src/chains/canonical.js";
import { protocols } from "../src/protocols/index.js";

/** Links whose `contract` is a deliberate OVERRIDE of what deriveContractName would compute from
 *  `abiExport` alone (see links.ts's module comment) -- these are EXPECTED to diverge, since
 *  deriveContractName has no notion of roleKey and would otherwise collapse e.g. all three
 *  compound-v3 Comet markets to the same name "Comet". */
const DELIBERATE_OVERRIDES = new Set([
  "uniswap-v3::swapRouter02",
  "compound-v3::cUSDCv3",
  "compound-v3::cWETHv3",
  "compound-v3::cUSDTv3",
  "erc4626::",
]);

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("descriptor linkage: every link resolves against the live vendored data", () => {
  it("every link's protocol exists in the registry", () => {
    for (const link of LINKS) {
      expect(getProtocol(link.protocol)).toBeDefined();
    }
  });

  it("every roleKey appears in >=1 ChainDeployment.addresses of that protocol", () => {
    for (const link of LINKS) {
      if (link.roleKey === undefined) continue;
      const info = getProtocol(link.protocol)!;
      const present = info.chains.some((d) => link.roleKey! in d.addresses);
      expect(present).toBe(true);
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

  it("interface implies abiExport only (no roleKey), and the protocol has zero deployments", () => {
    for (const link of LINKS) {
      if (link.kind !== "interface") continue;
      expect(link.roleKey).toBeUndefined();
      expect(link.abiExport).toBeDefined();
      const info = getProtocol(link.protocol)!;
      expect(info.chains.length).toBe(0);
    }
  });
});

describe("descriptor linkage: starter-set coverage lint", () => {
  it("every role key in a starter protocol's addresses.ts is claimed by exactly the expected residue (currently: zero unlinked)", () => {
    const starterProtocols = new Set(LINKS.map((l) => l.protocol));
    const unlinkedRoles: string[] = [];
    for (const protocolSlug of starterProtocols) {
      const info = getProtocol(protocolSlug)!;
      const allRoleKeys = new Set<string>();
      for (const deployment of info.chains) {
        for (const role of Object.keys(deployment.addresses)) allRoleKeys.add(role);
      }
      const linkedRoles = new Set(
        LINKS.filter((l) => l.protocol === protocolSlug)
          .map((l) => l.roleKey)
          .filter((r): r is string => r !== undefined),
      );
      for (const role of allRoleKeys) {
        if (!linkedRoles.has(role)) unlinkedRoles.push(`${protocolSlug}.${role}`);
      }
    }
    expect(unlinkedRoles).toEqual([]);
  });

  it("every abiExport claimed exists, and no starter protocol's abis.ts export is left unclaimed", () => {
    const starterProtocols = new Set(LINKS.map((l) => l.protocol));
    const unclaimed: string[] = [];
    for (const protocolSlug of starterProtocols) {
      const allExports = new Set(Object.keys(ABI_EXPORTS[protocolSlug] ?? {}));
      const claimed = new Set(
        LINKS.filter((l) => l.protocol === protocolSlug)
          .map((l) => l.abiExport)
          .filter((x): x is string => x !== undefined),
      );
      for (const exportName of allExports) {
        if (!claimed.has(exportName)) unclaimed.push(`${protocolSlug}.${exportName}`);
      }
    }
    expect(unclaimed).toEqual([]);
  });
});

describe("descriptor linkage: (protocol, contract) uniqueness (E2.3's key space)", () => {
  it("no two descriptors share a (protocol, contract) pair", () => {
    const keys = DESCRIPTORS.map((d) => `${d.protocol}::${d.contract}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every link has an explicit `contract` (required for E2.3's literal accessor-tree types)", () => {
    for (const link of LINKS) {
      expect(typeof link.contract).toBe("string");
    }
  });

  it("every non-override explicit `contract` equals what deriveContractName computes — the literal type can never drift from the derivation", () => {
    for (const link of LINKS) {
      if (link.abiExport === undefined) continue;
      if (DELIBERATE_OVERRIDES.has(`${link.protocol}::${link.roleKey ?? ""}`)) continue;
      const info = getProtocol(link.protocol)!;
      expect(link.contract).toBe(deriveContractName(info.name, link.abiExport));
    }
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
      expect(existsSync(jsonPath)).toBe(true);
    }
  });
});

describe("descriptor linkage: an overloaded name is unambiguous by argument count", () => {
  // The accessor and `methodOf` pick an overload by how many arguments it takes, and the route
  // rewrite binds a name with `.view` or `.at` before the compiler picks an overload. So overloads
  // of one name must differ in argument count, and be all view or all non-view.
  it("every starter-set ABI's overloads differ in argument count and agree on view vs non-view", () => {
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
});

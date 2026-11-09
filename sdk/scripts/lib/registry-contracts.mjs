// The registry's contracts and their names, as `gen-source-globals.mjs` exposes them and
// `gen-registry-abis.mjs` keeps each ABI's function names clear of them. One copy of the rules: see
// gen-source-globals.mjs's header for where each contract comes from and how it is named.

export const pascal = (slug) =>
  slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
export const camel = (slug) => {
  const p = pascal(slug).replace(/[^A-Za-z0-9]/g, "");
  return /^[0-9]/.test(p) ? `p${p}` : p[0].toLowerCase() + p.slice(1);
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const isEvmAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);

/** Camel-case words of an identifier: `clFactoryGaugeCaps` -> cl|Factory|Gauge|Caps, `stETHStrategy` -> st|ETH|Strategy. */
const words = (id) => id.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
const isUpper = (ch) => ch !== undefined && ch >= "A" && ch <= "Z";
const isLower = (ch) => ch !== undefined && ch >= "a" && ch <= "z";
const isDigit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";

/** The role's contract name: see gen-source-globals.mjs's header. */
export function roleName(role, abiExport) {
  const parts = words(role);
  if (abiExport !== undefined) {
    const abi = abiExport.replace(/ABI$/, "");
    const lower = abi.toLowerCase();
    for (let k = parts.length; k > 0; k--) {
      const prefix = parts.slice(0, k).join("").toLowerCase();
      for (let at = lower.indexOf(prefix); at !== -1; at = lower.indexOf(prefix, at + 1)) {
        const end = at + prefix.length;
        const startsWord =
          at === 0 ||
          (isUpper(abi[at]) &&
            (isLower(abi[at - 1]) || isDigit(abi[at - 1]) || isLower(abi[at + 1])));
        const endsWord = end === abi.length || isUpper(abi[end]) || isDigit(abi[end]);
        if (startsWord && endsWord) return cap(abi.slice(at, end) + parts.slice(k).join(""));
      }
    }
  }
  return cap(role);
}

/** An ABI export's contract name: the export without `ABI` and the protocol's own prefix. Mirrors
 *  `deriveContractName` in `src/descriptors/derive.ts`, which `descriptors-linkage.test.ts` pins. */
export function abiName(protocolName, slug, abiExport) {
  const base = abiExport.endsWith("ABI") ? abiExport.slice(0, -3) : abiExport;
  const prefixes = [
    protocolName.replace(/[^a-zA-Z0-9]/g, ""),
    pascal(slug).replace(/[^a-zA-Z0-9]/g, ""),
  ]
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const rest = base.slice(prefix.length);
    if (base.toLowerCase().startsWith(prefix.toLowerCase()) && /^[A-Z0-9]/.test(rest)) return rest;
  }
  return base;
}

/** Accessor properties a method or contract name must never shadow (see descriptors/accessors.ts). */
export const ACCESSOR_PROPERTIES = new Set([
  "descriptor",
  "chain",
  "address",
  "available",
  "chains",
  "coverage",
  "abi",
  "methods",
  "at",
]);

/**
 * One protocol's contracts: `{ protocol, contract, kind, roleKey?, abiExport?, chains?, caveats? }`
 * for each binding of `spec` (its `targets.json` entry) and each EVM role no binding claims.
 * `evmChainIds` are the canonical EVM chains. A role's deployment that does not run a function of
 * its ABI as declared is the evidence's to say, per chain (`gen-source-globals.mjs`'s `withheld`
 * and `shapes`).
 */
export function protocolContracts({ slug, info, deployments, spec, evmChainIds, fail }) {
  // Roles with an EVM address on a canonical EVM chain, in first-seen order.
  const evmRoles = [];
  for (const d of deployments) {
    if (!evmChainIds.has(d.chainId)) continue;
    for (const [role, address] of Object.entries(d.addresses)) {
      if (isEvmAddress(address) && !evmRoles.includes(role)) evmRoles.push(role);
    }
  }
  const exportsOfRole = new Map();
  for (const [exportName, binding] of Object.entries(spec)) {
    for (const role of binding.roles ?? []) {
      exportsOfRole.set(role, [...(exportsOfRole.get(role) ?? []), exportName]);
    }
  }
  /** chain id -> address, lowercase, for a role. */
  const addressesOf = (role) =>
    new Map(
      deployments
        .filter((d) => evmChainIds.has(d.chainId) && isEvmAddress(d.addresses[role] ?? ""))
        .map((d) => [d.chainId, d.addresses[role].toLowerCase()]),
    );

  const contracts = [];
  for (const [exportName, binding] of Object.entries(spec)) {
    const roles = binding.roles ?? [];
    if (roles.length === 0) {
      contracts.push({
        protocol: slug,
        contract: abiName(info.name, slug, exportName),
        kind: "interface",
        abiExport: exportName,
      });
      continue;
    }
    for (const role of roles) {
      const addresses = addressesOf(role);
      if (addresses.size === 0) continue;
      if (binding.unverifiable !== undefined) {
        contracts.push({
          protocol: slug,
          contract: roleName(role, exportName),
          kind: "address-only",
          roleKey: role,
          caveats: [`${exportName} does not describe this deployment: ${binding.unverifiable}`],
        });
        continue;
      }
      const split = (exportsOfRole.get(role) ?? []).length > 1;
      const chains = binding.chains;
      if (split && chains === undefined)
        fail(`${slug}.${role} is bound to several ABIs without \`chains\``);
      // One caveat per reason: a reference interface's adopted functions share theirs.
      const unverified = new Map();
      for (const [sig, reason] of Object.entries(binding.unverified ?? {})) {
        unverified.set(reason, [...(unverified.get(reason) ?? []), sig]);
      }
      const caveats = [...unverified].map(
        ([reason, sigs]) =>
          `${sigs.join(", ")} ${sigs.length === 1 ? "is" : "are"} checked against the deployed bytecode only: ${reason}`,
      );
      contracts.push({
        protocol: slug,
        contract: split ? abiName(info.name, slug, exportName) : roleName(role, exportName),
        kind: "singleton",
        roleKey: role,
        abiExport: exportName,
        ...(chains !== undefined ? { chains } : {}),
        ...(binding.default !== undefined ? { default: true } : {}),
        ...(caveats.length > 0 ? { caveats } : {}),
      });
    }
  }
  for (const role of evmRoles) {
    if (exportsOfRole.has(role)) continue;
    contracts.push({
      protocol: slug,
      contract: roleName(role, undefined),
      kind: "address-only",
      roleKey: role,
      caveats: ["the registry has no ABI for this contract: its address only"],
    });
  }
  return contracts;
}

/**
 * A protocol's default contract — `<Protocol>.<method>(...)` — the singleton its target marks
 * `default`, or else its one singleton.
 */
export function defaultContract(contracts) {
  const marked = contracts.filter((c) => c.default === true);
  if (marked.length > 1) throw new Error(`${marked[0].protocol}: two contracts are its default`);
  if (marked.length === 1) return marked[0];
  const singletons = contracts.filter((c) => c.kind === "singleton");
  return singletons.length === 1 ? singletons[0] : undefined;
}

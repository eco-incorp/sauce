#!/usr/bin/env node
// Generates every protocol namespace the SDK exposes, in both languages, from the registry:
//
//   src/descriptors/contracts.generated.ts — the contract table the runtime builds its descriptors
//     from (`CONTRACT_LINKS`, every protocol's ABIs and deployments), and the TypeScript type of the
//     host tree `Base.UniswapV3.QuoterV2`;
//   src/routes/source-globals.generated.ts — the declarations a compiled route body sees: the same
//     namespaces as Sauce scalars (`UniswapV3.QuoterV2`) and the token symbols.
//
// WHERE A CONTRACT COMES FROM. A protocol's `addresses.ts` names each deployed contract by a role
// key, and its `abis.ts` exports ABIs; `test/fixtures/registry-abi/targets.json` binds the two — it
// is the table `registry-abi.test.ts` checks every ABI against the deployed code with. A namespace
// therefore exposes a contract exactly as the registry evidences it:
//   - a role bound to an ABI is a contract with that ABI (`singleton`);
//   - a role bound to an ABI the evidence marks `unverifiable`, or bound to none, keeps its address
//     and has no methods (`address-only`);
//   - an ABI bound to no role (evidenced by representative `instances`) has no fixed address — the
//     caller binds one by calling it with an address, or with `.at(address)` (`interface`).
//
// WHAT A FUNCTION RETURNS. Where an export's binding in `targets.json` has `returns`, an address a
// function returns is a registry contract: `UniswapV3.Factory`'s `getPool` returns a
// `UniswapV3.Pool`, a pool's `token0()` a token (the registry's ERC-20 interface). The table
// (`RETURNED_CONTRACTS`) tells the route rewrite a method called on such a result is that
// contract's (`routes/contract-results.ts`), and the source declarations type the output as it.
//
// NAMES. A contract is named by its role key with the first letter upper-cased; where the role's
// leading words also appear, as words, in its ABI export's name, they take the ABI's spelling, so
// `clFactory` bound to `SlipstreamCLFactoryABI` is `CLFactory`. A contract with no role (an
// interface), or a role bound to different ABIs on different chains (Gamma's `uniProxy`), is named
// after its ABI export instead, without the trailing `ABI` and the protocol's own prefix. A protocol
// namespace is `PascalOf(slug)`; a slug ending in `-v<N>` also joins the family `PascalOf(stem)`,
// which exposes a contract only where exactly one member owns its name.
//
// Every value is read from the SDK's own modules (`scripts/lib/load-ts.mjs`): no build is needed,
// and nothing here is a hand-kept table. Regenerate after changing a registry ABI, role, binding or
// token symbol: `pnpm --filter './sdk' gen-source-globals` (`--check` exits 1 on drift).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { toFunctionSelector } from "viem";

import { createTsLoader } from "./lib/load-ts.mjs";
import {
  ACCESSOR_PROPERTIES,
  abiName,
  camel,
  defaultContract as defaultOf,
  pascal,
  protocolContracts,
} from "./lib/registry-contracts.mjs";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_SOURCE = resolve(sdk, "src/routes/source-globals.generated.ts");
const OUT_CONTRACTS = resolve(sdk, "src/descriptors/contracts.generated.ts");
const load = createTsLoader(sdk);

function fail(message) {
  throw new Error(`gen-source-globals: ${message}`);
}

// --- registry --------------------------------------------------------------------------------

const { CANONICAL_CHAINS } = load("src/chains/canonical.ts");
const { listProtocols } = load("src/protocols/index.ts");
const { TOKEN_REGISTRY, SVM_TOKEN_REGISTRY } = load("src/routes/token-registry.ts");
const { SVM_VENUE_NAMESPACES } = load("src/routes/svm-venue-methods.ts");
const targets = JSON.parse(
  readFileSync(resolve(sdk, "test/fixtures/registry-abi/targets.json"), "utf8"),
).protocols;

const evmChainIds = new Set(CANONICAL_CHAINS.filter((c) => c.kind === "evm").map((c) => c.id));

const protocols = [...listProtocols()].sort((a, b) => a.slug.localeCompare(b.slug));
/** slug -> { info, abis, deployments, contracts: link[] } */
const registry = new Map();

for (const info of protocols) {
  const slug = info.slug;
  const abis = load(`src/protocols/${slug}/abis.ts`);
  const { deployments } = load(`src/protocols/${slug}/addresses.ts`);
  const spec = targets[slug] ?? {};
  for (const name of Object.keys(abis)) {
    if (Array.isArray(abis[name]) && spec[name] === undefined) {
      fail(`${slug}.${name} has no binding in targets.json (registry-abi.test.ts requires one)`);
    }
  }
  for (const name of Object.keys(spec)) {
    if (!Array.isArray(abis[name]))
      fail(`${slug}: targets.json binds '${name}', which abis.ts does not export`);
  }
  const contracts = protocolContracts({ slug, info, deployments, spec, evmChainIds, fail });

  const names = new Set();
  for (const c of contracts) {
    if (!ts.isIdentifierText(c.contract, ts.ScriptTarget.Latest))
      fail(`${slug}: '${c.contract}' is not an identifier`);
    if (names.has(c.contract)) fail(`${slug}: two contracts are named '${c.contract}'`);
    if (ACCESSOR_PROPERTIES.has(c.contract))
      fail(`${slug}.${c.contract} shadows an accessor property`);
    names.add(c.contract);
    for (const item of c.abiExport ? abis[c.abiExport] : []) {
      if (item.type === "function" && ACCESSOR_PROPERTIES.has(item.name)) {
        fail(`${slug}.${c.contract}.${item.name} shadows an accessor property`);
      }
    }
  }
  registry.set(slug, { info, abis, deployments, contracts });
}

const LINKS = [...registry.values()].flatMap((p) => p.contracts);

// --- what a function returns ---------------------------------------------------------------------

/** The registry's ERC-20 interface: a token a function returns is called as `Token(address)` for
 *  its writes, which have SafeERC20 semantics, and as this ABI for its reads (`contract-results.ts`). */
const TOKEN_ABI = "erc20/ERC20ABI";

const canonicalType = (p) =>
  p.type.startsWith("tuple")
    ? `(${(p.components ?? []).map(canonicalType).join(",")})${p.type.slice("tuple".length)}`
    : p.type;
const signatureOf = (f) => `${f.name}(${f.inputs.map(canonicalType).join(",")})`;

// --- what a chain's deployment does not run, and what it declares otherwise --------------------

/**
 * A registry ABI is the union of what its deployments run (`gen-registry-abis.mjs`), so a role's
 * deployment on one chain may lack a function another chain's has, or declare it otherwise. Per
 * chain:
 *  - a function its deployment DECLARES OTHERWISE — it dispatches the selector, and its verified ABI
 *    declares the same signature with other outputs, another mutability or other struct field
 *    names — is served there as that deployment declares it: its verified fragment is in `shapes`,
 *    and the chain's view of the contract carries it in place of the export's (`descriptorOn`);
 *  - every other function its deployment does not run as declared — it does not dispatch the
 *    selector, or its verified ABI declares only another overload of the name, or its declaration
 *    would mix reads and writes among the name's overloads — is `withheld` there: a program
 *    compiled for that chain cannot call it.
 * `registry-abi.test.ts` checks both tables against the evidence.
 */
const evidence = JSON.parse(
  readFileSync(resolve(sdk, "test/fixtures/registry-abi/evidence.json"), "utf8"),
);
const rowOf = new Map(
  evidence.instances.map((r) => [`${r.protocol}|${r.abi}|${r.chainId}|${r.address}`, r]),
);
const fieldNames = (params) =>
  params
    .map((p) =>
      p.components
        ? `{${p.components.map((c) => (c.name ?? "").replace(/^_+|_+$/g, "").toLowerCase() + fieldNames([c])).join(",")}}`
        : "",
    )
    .join(",");
const declaration = (f) =>
  JSON.stringify([
    (f.outputs ?? []).map(canonicalType),
    f.stateMutability === "pure" ? "view" : (f.stateMutability ?? "nonpayable"),
    fieldNames(f.inputs ?? []),
  ]);
const isRead = (f) => f.stateMutability === "view" || f.stateMutability === "pure";
/** A verified fragment's parameter as an ABI parameter. */
const abiParam = (p) => ({
  name: p.name ?? "",
  type: p.type,
  ...(p.components ? { components: p.components.map(abiParam) } : {}),
});
/**
 * How `row`, one deployment's evidence, runs `fn`: `true` as the registry declares it; where it
 * dispatches the selector and its verified ABI declares the signature otherwise, that declaration
 * as an ABI item; else `false`.
 */
function runs(row, fn) {
  if (row === undefined || row.error !== undefined) return false;
  const sig = signatureOf(fn);
  const where = row.selectors?.[toFunctionSelector(sig)];
  if (where === undefined || where === null) return false;
  const name = `${fn.name}(`;
  const overloads = (row.verified ?? [])
    .map((id) => evidence.fragments[id])
    .filter((f) => f.type === undefined && f.signature.startsWith(name));
  if (overloads.length === 0) return true;
  const exact = overloads.find((f) => f.signature === sig);
  if (exact === undefined) return false;
  if (declaration(exact) === declaration(fn)) return true;
  return {
    name: fn.name,
    type: "function",
    stateMutability: exact.stateMutability ?? "nonpayable",
    inputs: (exact.inputs ?? []).map(abiParam),
    outputs: (exact.outputs ?? []).map(abiParam),
  };
}
for (const [slug, { abis, deployments }] of registry) {
  for (const c of registry.get(slug).contracts) {
    if (c.kind !== "singleton") continue;
    const functions = abis[c.abiExport].filter((item) => item.type === "function");
    const withheld = {};
    const shapes = {};
    for (const d of deployments) {
      const address = d.addresses[c.roleKey];
      if (!evmChainIds.has(d.chainId) || !/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) continue;
      if (c.chains !== undefined && !c.chains.includes(d.chainId)) continue;
      const row = rowOf.get(`${slug}|${c.abiExport}|${d.chainId}|${address.toLowerCase()}`);
      const lacking = [];
      const declared = [];
      for (const fn of functions) {
        const how = runs(row, fn);
        if (how === true) continue;
        // A name's overloads are all reads or all writes (`descriptors-linkage.test.ts`): a
        // declaration that would make them mix is withheld instead.
        const mixes =
          how !== false &&
          functions.some(
            (other) => other !== fn && other.name === fn.name && isRead(other) !== isRead(how),
          );
        if (how === false || mixes) lacking.push(signatureOf(fn));
        else declared.push(how);
      }
      if (lacking.length > 0) withheld[d.chainId] = lacking;
      if (declared.length > 0) shapes[d.chainId] = declared;
    }
    if (Object.keys(withheld).length > 0) c.withheld = withheld;
    if (Object.keys(shapes).length > 0) c.shapes = shapes;
  }
}

// --- what a program calls by signature ----------------------------------------------------------

/**
 * The functions an export's deployments run that its ABI leaves out for their name or their arity
 * alone (a second overload of one arity, an overload that would mix reads and writes, a name the
 * SDK reads as its own): `omitted.json` carries each one's ABI entry (`gen-registry-abis.mjs`), and
 * a program calls it by its full signature, `<Contract>["<signature>"](…)` (`protocol-rewrite.ts`).
 * They are `bySignature` on every contract of the export, and, per chain, those a role's deployment
 * does not run as that entry declares them are `bySignatureWithheld` there, as `withheld` is for
 * the ABI's own. The twins and the names callable by name are untouched.
 */
const omittedExports = JSON.parse(
  readFileSync(resolve(sdk, "test/fixtures/registry-abi/omitted.json"), "utf8"),
).exports;
for (const [slug, { deployments }] of registry) {
  for (const c of registry.get(slug).contracts) {
    if (c.abiExport === undefined || c.kind === "address-only") continue;
    const functions = (omittedExports[`${slug}.${c.abiExport}`] ?? []).flatMap((o) =>
      o.function === undefined ? [] : [o.function],
    );
    if (functions.length === 0) continue;
    c.bySignature = functions;
    if (c.kind !== "singleton") continue;
    const withheld = {};
    for (const d of deployments) {
      const address = d.addresses[c.roleKey];
      if (!evmChainIds.has(d.chainId) || !/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) continue;
      if (c.chains !== undefined && !c.chains.includes(d.chainId)) continue;
      const row = rowOf.get(`${slug}|${c.abiExport}|${d.chainId}|${address.toLowerCase()}`);
      const lacking = functions.filter((fn) => runs(row, fn) !== true).map(signatureOf);
      if (lacking.length > 0) withheld[d.chainId] = lacking;
    }
    if (Object.keys(withheld).length > 0) c.bySignatureWithheld = withheld;
  }
}

/** `getPool(address,address,uint24)` -> that and `[]`; `poolInfo(uint256).crvRewards` -> `["crvRewards"]`. */
function returnKey(key) {
  let depth = 0;
  for (let at = 0; at < key.length; at++) {
    if (key[at] === "(") depth++;
    if (key[at] !== ")" || --depth > 0) continue;
    const rest = key.slice(at + 1);
    if (rest !== "" && !/^(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(rest)) break;
    return { signature: key.slice(0, at + 1), path: rest === "" ? [] : rest.slice(1).split(".") };
  }
  fail(`'${key}' is not a function signature with an optional field path`);
}

/** The output parameter `path` leads to: the one output, or a field of the record it returns. */
function outputAt(outputs, path) {
  if (path.length === 0) return outputs.length === 1 ? outputs[0] : undefined;
  let fields =
    outputs.length === 1 && outputs[0].type === "tuple" ? outputs[0].components : outputs;
  let found;
  for (const name of path) {
    found = (fields ?? []).find((field) => field.name === name);
    if (found === undefined) return undefined;
    fields = found.type === "tuple" ? found.components : undefined;
  }
  return found;
}

/** Every annotated output, with the contract it is: `{ protocol, abiExport, signature, path,
 *  returns: { protocol, contract } }`, plus the target's ABI export for the declarations. */
const RETURNED = [];
for (const [slug, { abis }] of registry) {
  for (const [exportName, binding] of Object.entries(targets[slug] ?? {})) {
    for (const [key, abi] of Object.entries(binding.returns ?? {})) {
      const { signature, path } = returnKey(key);
      const fn = abis[exportName].find(
        (item) => item.type === "function" && signatureOf(item) === signature,
      );
      if (fn === undefined) fail(`${slug}.${exportName} returns: no function ${signature}`);
      if (outputAt(fn.outputs ?? [], path)?.type !== "address") {
        fail(`${slug}.${exportName} returns: ${key} is not an address ${signature} returns`);
      }
      const [targetSlug, targetExport] = String(abi).split("/");
      const named = (registry.get(targetSlug)?.contracts ?? []).filter(
        (c) => c.abiExport === targetExport && c.kind !== "address-only",
      );
      const contract = named.find((c) => c.kind === "interface") ?? named[0];
      if (contract === undefined) {
        fail(`${slug}.${exportName} returns: ${key} is '${abi}', no registry contract`);
      }
      RETURNED.push({
        protocol: slug,
        abiExport: exportName,
        signature,
        path,
        returns: { protocol: targetSlug, contract: contract.contract },
        abi,
      });
    }
  }
}

// --- namespaces, families, collisions ----------------------------------------------------------

/** A protocol's default contract — `<Protocol>.<method>(...)` — when it has exactly one singleton. */
const defaultContract = (slug) => defaultOf(registry.get(slug).contracts);

const namespaceOf = new Map(); // namespace key -> slug
for (const slug of registry.keys()) {
  if (registry.get(slug).contracts.length === 0) continue;
  const key = pascal(slug);
  if (namespaceOf.has(key)) fail(`duplicate protocol namespace '${key}'`);
  namespaceOf.set(key, slug);
}
const families = new Map(); // family key -> member slugs
for (const slug of namespaceOf.values()) {
  const stem = /^(.+)-v\d+$/.exec(slug)?.[1];
  if (stem === undefined) continue;
  const key = pascal(stem);
  families.set(key, [...(families.get(key) ?? []), slug]);
}
for (const key of families.keys()) {
  if (namespaceOf.has(key)) fail(`family alias '${key}' collides with a protocol namespace`);
}
/** family key -> contract name -> owning slug, for the names exactly one member owns. */
function familyContracts(members) {
  const owners = new Map();
  for (const slug of members) {
    for (const c of registry.get(slug).contracts)
      owners.set(c.contract, [...(owners.get(c.contract) ?? []), slug]);
  }
  return [...owners]
    .filter(([, slugs]) => slugs.length === 1)
    .map(([name, [slug]]) => [name, slug]);
}

const tokens = [
  ...new Set(
    Object.values(TOKEN_REGISTRY)
      .flat()
      .map((row) => row.symbol),
  ),
].sort();
// Solana's mints: a symbol only a Solana program has is its mint's key with the same token methods
// (on Solana the SDK adds the accounts they move through to main); one an EVM chain also has keeps
// the EVM declaration, which is the same.
const mints = [
  ...new Set(
    Object.values(SVM_TOKEN_REGISTRY)
      .flat()
      .map((row) => row.symbol),
  ),
]
  .filter((symbol) => !tokens.includes(symbol))
  .sort();
const reserved = new Map([
  ...CANONICAL_CHAINS.map((c) => [pascal(c.slug), `the chain '${c.slug}'`]),
  ["Token", "the Token global"],
  ["chain", "the chain front door"],
  ["chainId", "the chain id define"],
  ["CHAIN_ID", "the chain id define"],
]);
function claim(name, what) {
  if (!ts.isIdentifierText(name, ts.ScriptTarget.Latest))
    fail(`'${name}' (${what}) is not an identifier`);
  const prior = reserved.get(name);
  if (prior !== undefined) fail(`'${name}' (${what}) collides with ${prior}`);
  reserved.set(name, what);
}
for (const [key, slug] of namespaceOf) claim(key, `the protocol namespace of ${slug}`);
for (const key of families.keys()) claim(key, "a family alias");
for (const token of tokens) claim(token, "a token symbol");
for (const mint of mints) claim(mint, "a Solana mint symbol");
// A Solana venue is its protocol's program (`Orca.Whirlpool`): its protocol a name of its own, or a
// field of a protocol namespace or family of the same name (`Pancakeswap`).
const venueFields = new Map();
for (const [venue, { exact, key, refinement }] of Object.entries(SVM_VENUE_NAMESPACES)) {
  const [protocol, program] = venue.split(".");
  if (!ts.isIdentifierText(program, ts.ScriptTarget.Latest))
    fail(`'${venue}' (a Solana venue namespace) does not name a program`);
  const type = exact
    ? "SauceSvmExactVenueSource"
    : key === "fee"
      ? "SauceSvmFeeVenueSource"
      : key === "tick spacing"
        ? refinement === "feeTierIndex"
          ? "SauceSvmTierVenueSource"
          : "SauceSvmSpacingVenueSource"
        : "SauceSvmVenueSource";
  venueFields.set(protocol, [
    ...(venueFields.get(protocol) ?? []),
    `  readonly ${program}: ${type};`,
  ]);
}
for (const protocol of venueFields.keys()) {
  if (!namespaceOf.has(protocol) && !families.has(protocol))
    claim(protocol, "a Solana venue protocol");
}

// --- Sauce source declarations ---------------------------------------------------------------------

/**
 * A parameter's type in compiled source. An output the registry knows the contract of (`returns`,
 * keyed by its field path) is that contract's methods on the address: `bigint & UniswapV3PoolMethods`.
 */
function valueType(parameter, input, returns, path = []) {
  const array = /^(.*)\[\d*\]$/.exec(parameter.type);
  if (array) {
    const element = valueType({ ...parameter, type: array[1] }, input);
    return input ? `(readonly (${element})[] | SauceArray<${element}>)` : `SauceArray<${element}>`;
  }
  if (/^int\d*$/.test(parameter.type)) return "Int256";
  // An argument takes any SauceScript number, a plain `500` included, a field deep or more as
  // much as at the top; what comes back is a bigint.
  if (/^(u?int\d*|address|bytes\d+)$/.test(parameter.type)) {
    if (input) return "(bigint | number)";
    const contract = returns?.get(path.join("."));
    return contract === undefined ? "bigint" : `bigint & ${contract}`;
  }
  if (parameter.type === "bool") return "boolean";
  if (/^(bytes|string)$/.test(parameter.type))
    return input ? "(string | SauceBytes)" : "SauceBytes";
  if (parameter.type === "tuple") {
    const fields = parameter.components ?? [];
    if (fields.length === 0) return "Record<string, never>";
    if (
      fields.some((field) => !field.name) ||
      new Set(fields.map((field) => field.name)).size !== fields.length
    )
      return undefined; // a Sauce tuple binds object-literal keys, so it needs named components
    const typed = fields.map((field) => [
      field.name,
      valueType(field, input, returns, [...path, field.name]),
    ]);
    if (typed.some(([, type]) => type === undefined)) return undefined;
    return `{ ${typed.map(([name, type]) => `${JSON.stringify(name)}: ${type}`).join("; ")} }`;
  }
  return undefined;
}

function resultType(outputs, returns) {
  if (!outputs.length) return "void";
  if (outputs.length === 1) return valueType(outputs[0], false, returns);
  const types = outputs.map((field) => valueType(field, false, returns, [field.name ?? ""]));
  if (types.some((type) => type === undefined)) return undefined;
  const tuple = `[${types.join(", ")}]`;
  const named = outputs.filter((field) => field.name);
  if (new Set(named.map((field) => field.name)).size !== named.length) return tuple;
  return named.length
    ? `${tuple} & { ${named.map((field) => `${JSON.stringify(field.name)}: ${valueType(field, false, returns, [field.name])}`).join("; ")} }`
    : tuple;
}

/** Method declarations of one ABI. A function whose types Sauce has no source spelling for is
 *  declared over `unknown`, so it stays callable from a typed closure and the compiler decides.
 *  `returnsOf(signature)` maps an annotated function's field paths to the contract types. Each of
 *  `bySignature`, a function a program calls by its full signature only, is declared under that
 *  signature: `"permitTransferFrom(((address,uint256)[],uint256,uint256),…)"(…)`. */
function sourceMethods(abi, returnsOf, bySignature = []) {
  const declare = (key, method) => {
    const inputs = method.inputs.map((field) => valueType(field, true));
    const output = resultType(method.outputs ?? [], returnsOf(signatureOf(method)));
    const args = method.inputs
      .map((_, index) => `arg${index}: ${inputs[index] ?? "unknown"}`)
      .join(", ");
    return `  ${JSON.stringify(key)}(${args}): SauceCall<${output ?? "unknown"}>;`;
  };
  return [
    ...abi.filter((entry) => entry.type === "function").map((m) => declare(m.name, m)),
    ...bySignature.map((m) => declare(signatureOf(m), m)),
  ];
}

const methodsInterface = new Map(); // `${slug}:${abiExport}` -> interface name
const sourceDefinitions = [];
const usedInterfaceNames = new Set();
for (const [slug, { info, contracts }] of registry) {
  for (const c of contracts) {
    if (c.abiExport === undefined || methodsInterface.has(`${slug}:${c.abiExport}`)) continue;
    const name = `${pascal(slug)}${abiName(info.name, slug, c.abiExport)}Methods`;
    if (usedInterfaceNames.has(name)) fail(`two ABIs declare methods interface '${name}'`);
    usedInterfaceNames.add(name);
    methodsInterface.set(`${slug}:${c.abiExport}`, name);
  }
}
/** The type an annotated output has: the contract's methods, a token's being `SauceReturnedToken`. */
const returnedType = (r) =>
  r.abi === TOKEN_ABI ? "SauceReturnedToken" : methodsInterface.get(r.abi.replace("/", ":"));
for (const [key, name] of methodsInterface) {
  const [slug, abiExport] = key.split(":");
  const returnsOf = (signature) =>
    new Map(
      RETURNED.filter(
        (r) => r.protocol === slug && r.abiExport === abiExport && r.signature === signature,
      ).map((r) => [r.path.join("."), returnedType(r)]),
    );
  const bySignature = (omittedExports[`${slug}.${abiExport}`] ?? []).flatMap((o) =>
    o.function === undefined ? [] : [o.function],
  );
  sourceDefinitions.push(
    `export interface ${name} {\n${sourceMethods(registry.get(slug).abis[abiExport], returnsOf, bySignature).join("\n")}\n}`,
  );
}
if (RETURNED.some((r) => r.abi === TOKEN_ABI)) {
  const token = methodsInterface.get(TOKEN_ABI.replace("/", ":"));
  sourceDefinitions.push(`/**
 * A token a registry call returns (a pool's \`token0()\`, a vault's \`asset()\`): the ERC-20 ABI's
 * reads, and the writes of \`Token(address)\`, which return nothing and revert the program unless
 * the token accepted them (SafeERC20).
 */
export interface SauceReturnedToken extends Omit<${token}, "transfer" | "approve" | "transferFrom"> {
  transfer(to: bigint, amount: bigint): void;
  approve(spender: bigint, amount: bigint): void;
  transferFrom(from: bigint, to: bigint, amount: bigint): void;
}`);
}

function sourceContractType(c) {
  if (c.kind === "address-only") return "bigint";
  const methods = methodsInterface.get(`${c.protocol}:${c.abiExport}`);
  return c.kind === "interface" ? `SauceInterface<${methods}>` : `SauceContract<${methods}>`;
}

const globalDeclarations = [];
for (const [key, slug] of namespaceOf) {
  const { contracts } = registry.get(slug);
  const fallback = defaultContract(slug);
  const heritage = fallback
    ? ` extends ${methodsInterface.get(`${slug}:${fallback.abiExport}`)}`
    : "";
  if (fallback) {
    const shadowed = registry
      .get(slug)
      .abis[fallback.abiExport].filter(
        (m) => m.type === "function" && contracts.some((c) => c.contract === m.name),
      );
    if (shadowed.length > 0)
      fail(`${slug}: default-contract method '${shadowed[0].name}' collides with a contract name`);
  }
  const fields = [
    ...contracts.map((c) => `  readonly ${c.contract}: ${sourceContractType(c)};`),
    ...(venueFields.get(key) ?? []),
  ];
  sourceDefinitions.push(`export interface ${key}Source${heritage} {\n${fields.join("\n")}\n}`);
  globalDeclarations.push(`  const ${key}: ${key}Source;`);
}
for (const [family, members] of families) {
  const fields = [
    ...familyContracts(members).map(
      ([name, slug]) => `  readonly ${name}: ${pascal(slug)}Source[${JSON.stringify(name)}];`,
    ),
    ...(venueFields.get(family) ?? []),
  ];
  sourceDefinitions.push(`export interface ${family}FamilySource {\n${fields.join("\n")}\n}`);
  globalDeclarations.push(`  const ${family}: ${family}FamilySource;`);
}
for (const token of tokens) globalDeclarations.push(`  const ${token}: bigint & SauceTokenSource;`);
for (const mint of mints) globalDeclarations.push(`  const ${mint}: bigint & SauceTokenSource;`);
for (const [protocol, fields] of venueFields) {
  if (namespaceOf.has(protocol) || families.has(protocol)) continue;
  sourceDefinitions.push(`export interface ${protocol}SvmVenuesSource {\n${fields.join("\n")}\n}`);
  globalDeclarations.push(`  const ${protocol}: ${protocol}SvmVenuesSource;`);
}

const sourceGenerated = `// GENERATED by sdk/scripts/gen-source-globals.mjs — do not edit.
// Source-only names for compiled route bodies. No runtime objects are installed: every name resolves
// for the destination chain at compile time. TypeScript checks names and call shapes; the SDK checks
// per-chain deployment, and the Sauce compiler its own language subset and target capabilities.

/** An external call's result, with an optional gas cap and a failure handler. */
export type SauceCall<R> = R & {
  gas(cap: bigint): SauceCall<R>;
  catch(handler: (error: SauceBytes) => unknown): SauceCall<R>;
};

/**
 * A token's methods in compiled source. Addresses are Sauce scalars. The writes return nothing: each
 * reverts the program unless the token accepted it — on an EVM chain with SafeERC20 semantics, on
 * Solana through the mint's token program, the accounts each moves through added to main.
 */
export interface SauceTokenSource {
  transfer(to: bigint, amount: bigint): void;
  approve(spender: bigint, amount: bigint): void;
  transferFrom(from: bigint, to: bigint, amount: bigint): void;
  balanceOf(owner: bigint): bigint;
  /** Solana: the holder's associated account for the token, under the mint's token program. */
  accountOf(holder: bigint): SauceSolanaAccount;
  /** Solana: the token's mint. */
  readonly mint: SauceSolanaAccount;
  /** Solana: the token program that owns the mint, SPL Token or Token-2022. */
  readonly tokenProgram: SauceSolanaAccount;
}

/**
 * An account a program compiled for Solana writes where it uses it (\`Account.pda(…)\`,
 * \`USDC.accountOf(holder)\`): added to main as a parameter and derived as the cook is built, so what
 * it is made of is known then. Read-only unless \`.writable()\` or \`.signer()\` gives it that role.
 */
export interface SauceSolanaAccountFields {
  readonly address: bigint;
  readonly owner: bigint;
  readonly dataLen: bigint;
  writable(): SauceSolanaAccount;
  signer(): SauceSolanaAccount;
}
export type SauceSolanaAccount = bigint & SauceSolanaAccountFields;

/**
 * \`Account\` as a value, in a program compiled for Solana: the account at a key, the address a
 * program derives, and the programs a program calls. As a type, \`Account\` is an account main takes.
 */
export interface SauceAccountFactory {
  /** The account at a key. */
  (key: bigint): SauceSolanaAccount;
  /** The address \`program\` derives for the seeds: strings, keys, symbols, an integer's \`.toBytesLe(n)\`. */
  pda(program: bigint, seeds: readonly (string | bigint | SauceBytes)[]): SauceSolanaAccount;
  readonly systemProgram: SauceSolanaAccount;
  readonly tokenProgram: SauceSolanaAccount;
  readonly token2022Program: SauceSolanaAccount;
  readonly associatedTokenProgram: SauceSolanaAccount;
  readonly memoProgram: SauceSolanaAccount;
}

/**
 * A Solana venue's swap at one pool, in a program compiled for Solana: the pool and both tokens are
 * known when the cook is built, which reads the pool's accounts from it; what arrives lands in the
 * Pot's own account for the token bought. It returns 0, having moved nothing, where the pool cannot
 * trade (past \`priceLimit\`, empty, paused, no pool), and reverts below \`minOut\`.
 */
export interface SauceSvmVenueSource {
  swap(pool: bigint, tokenIn: bigint, tokenOut: bigint, amountIn: bigint, priceLimit: bigint, minOut: bigint): bigint;
}

/**
 * A Solana venue's swap of an exact input at one pool, with no price limit: it pays all of
 * \`amountIn\` or fails the transaction, and reverts below \`minOut\`; 0, having moved nothing, for no
 * pool or no input. Its accounts are read from the pool as \`SauceSvmVenueSource\`'s are.
 */
export interface SauceSvmExactVenueSource {
  swap(pool: bigint, tokenIn: bigint, tokenOut: bigint, amountIn: bigint, minOut: bigint): bigint;
}

/**
 * A Solana venue whose pools are found by tick spacing: \`pool(tokenA, tokenB, tickSpacing)\` is
 * the pool its program keeps for the pair at that spacing, written as a swap's pool, the spacing a
 * number written out (or a loop's over numbers written out). Where there is none, the swap returns 0.
 */
export interface SauceSvmSpacingVenueSource extends SauceSvmVenueSource {
  pool(tokenA: bigint, tokenB: bigint, tickSpacing: bigint): bigint;
}

/**
 * A whirlpool venue, whose pools are found by tick spacing: \`pool(tokenA, tokenB, tickSpacing)\`,
 * written as a swap's pool, is the pool on the spacing's static fee tier, and an adaptive-fee
 * tier's pool takes the tier's index after the spacing. Where there is none, the swap returns 0.
 */
export interface SauceSvmTierVenueSource extends SauceSvmVenueSource {
  pool(tokenA: bigint, tokenB: bigint, tickSpacing: bigint, feeTierIndex?: bigint): bigint;
}

/**
 * A Solana venue whose pools are found by fee, in millionths (400 is 0.04%), as an EVM pool's:
 * \`pool(tokenA, tokenB, fee)\`, written as a swap's pool, with the tick spacing after the fee
 * where the venue keeps two configs at it. Where there is none, the swap returns 0.
 */
export interface SauceSvmFeeVenueSource extends SauceSvmVenueSource {
  pool(tokenA: bigint, tokenB: bigint, fee: bigint, tickSpacing?: bigint): bigint;
}

/** A collection returned by Sauce, whose length is a Sauce scalar. */
export interface SauceArray<T> {
  readonly length: bigint;
  [index: number]: T;
}

/** Bytes returned by a contract call inside compiled source, not a host Uint8Array. */
export interface SauceBytes extends SauceArray<bigint> {
  slice(start: bigint, end: bigint): SauceBytes;
  toBe(): bigint;
  toLe(): bigint;
}

/** \`.at(address)\`: the same ABI at another address. */
export interface SauceBinding<Methods> {
  at(address: bigint): Methods;
}

/** A registry ABI with no fixed address: called with the address of a deployment,
 *  \`UniswapV3.Pool(pool).liquidity()\`, or \`.at(address)\`. */
export interface SauceInterface<Methods> extends SauceBinding<Methods> {
  (address: bigint): Methods;
}

/** A deployed registry contract: its address on the destination chain, its methods, and
 *  \`.at(address)\` to call another deployment of the same ABI. */
export type SauceContract<Methods> = bigint & Methods & SauceBinding<Methods>;

${sourceDefinitions.join("\n\n")}

declare global {
${globalDeclarations.join("\n")}
  /** The id of the chain the program is compiled for. */
  const chainId: bigint;
  const CHAIN_ID: bigint;
}
`;

// --- TypeScript host types and the runtime contract table ------------------------------------------

const abiImports = [];
const sources = [];
for (const slug of registry.keys()) {
  const local = camel(slug);
  abiImports.push(`import * as ${local}Abis from "../protocols/${slug}/abis.js";`);
  abiImports.push(
    `import { deployments as ${local}Deployments } from "../protocols/${slug}/addresses.js";`,
  );
  sources.push(
    `  ${JSON.stringify(slug)}: { abis: ${local}Abis, deployments: ${local}Deployments },`,
  );
}

function hostContractType(c) {
  if (c.kind === "address-only") return "AddressOnlyContract";
  const abi = `typeof ${camel(c.protocol)}Abis.${c.abiExport}`;
  return c.kind === "interface" ? `InterfaceContract<${abi}>` : `Contract<${abi}>`;
}

const hostDefinitions = [];
const hostTree = [];
for (const [key, slug] of namespaceOf) {
  const fields = registry
    .get(slug)
    .contracts.map((c) => `  readonly ${c.contract}: ${hostContractType(c)};`);
  hostDefinitions.push(`export interface ${key}Contracts {\n${fields.join("\n")}\n}`);
  hostTree.push(`  readonly ${key}: ${key}Contracts;`);
}
for (const [family, members] of families) {
  const fields = familyContracts(members).map(
    ([name, slug]) => `  readonly ${name}: ${pascal(slug)}Contracts[${JSON.stringify(name)}];`,
  );
  hostDefinitions.push(`export interface ${family}FamilyContracts {\n${fields.join("\n")}\n}`);
  hostTree.push(`  readonly ${family}: ${family}FamilyContracts;`);
}

const literal = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? `{ ${Object.entries(value)
        .map(([k, v]) => `${k}: ${literal(v)}`)
        .join(", ")} }`
    : JSON.stringify(value);
const renderLink = (c) => `  ${literal(c)},`;

const contractsGenerated = `// GENERATED by sdk/scripts/gen-source-globals.mjs — do not edit.
// Every registry contract, as \`descriptors/registry.ts\` builds its descriptors and the host tree
// (\`Base.UniswapV3.QuoterV2\`) types it. See the generator's header for where each entry comes from
// and how it is named.
import type { ContractLink, ReturnedContractLink } from "./links.js";
import type { AddressOnlyContract, Contract, InterfaceContract } from "./accessors.js";
${abiImports.join("\n")}

/** Every registry protocol's ABI exports and deployments, by slug. */
export const PROTOCOL_SOURCES = {
${sources.join("\n")}
} as const;

/** One entry per contract: ${LINKS.length} contracts across ${namespaceOf.size} protocols. */
export const CONTRACT_LINKS = [
${LINKS.map(renderLink).join("\n")}
] as const satisfies readonly ContractLink[];

/** ${RETURNED.length} function outputs whose contract the registry knows. */
export const RETURNED_CONTRACTS = [
${RETURNED.map(({ abi: _abi, ...r }) => renderLink(r)).join("\n")}
] as const satisfies readonly ReturnedContractLink[];

${hostDefinitions.join("\n\n")}

/** The contract tree every chain accessor carries: one namespace per registry protocol and one
 *  per family alias. Chain-independent: whether a contract is deployed on a chain is its
 *  \`.available\`. */
export interface ChainContracts {
${hostTree.join("\n")}
}
`;

// --- write ---------------------------------------------------------------------------------------

const outputs = [
  [OUT_CONTRACTS, contractsGenerated],
  [OUT_SOURCE, sourceGenerated],
];
if (process.argv.includes("--stdout")) {
  for (const [, text] of outputs) process.stdout.write(text);
} else if (process.argv.includes("--check")) {
  const stale = outputs.filter(([path, text]) => readFileSync(path, "utf8") !== text);
  if (stale.length > 0) {
    process.stderr.write(
      `${stale.map(([path]) => path).join(", ")} stale; run pnpm --filter './sdk' gen-source-globals\n`,
    );
    process.exitCode = 1;
  }
} else {
  for (const [path, text] of outputs) {
    writeFileSync(path, text);
    process.stdout.write(`wrote ${path}\n`);
  }
}

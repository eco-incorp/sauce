/**
 * The protocol registry's ABIs, checked against the contracts they describe.
 *
 * For every function every `abis.ts` export declares:
 *   - the deployed contract must dispatch its selector (proxies, clones and diamonds resolved), on
 *     every captured deployment — a wrong parameter type is a different selector;
 *   - where a verified ABI exists (Sourcify, Blockscout, a keyless Etherscan-compatible API), the
 *     outputs, the state mutability and the struct field names must match it — a selector cannot
 *     catch a wrong output type, and a `view` that writes state reverts under STATICCALL.
 *
 * OFFLINE. The evidence is `fixtures/registry-abi/evidence.json`, captured by
 * `scripts/capture-registry-abi.mjs` only when asked to (see CLAUDE.md). A registry edit the
 * fixture does not cover fails here, naming what to recapture, instead of passing unchecked.
 *
 * `fixtures/registry-abi/targets.json` says which deployments evidence which export, and records
 * every exception with its reason: `exempt` (a deployment that legitimately differs, e.g. a bridged
 * token without the L1 token's functions), `unverified` (no verified source on Sourcify, Blockscout or
 * a keyless Etherscan-compatible API, so only the selector is checked) and `unverifiable` (nothing
 * on-chain can evidence the export at all). An exception that no longer applies fails too, so the
 * list cannot rot.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toFunctionSelector } from "viem";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOLS = join(SDK, "src", "protocols");
const FIXTURES = join(SDK, "test", "fixtures", "registry-abi");

interface Param {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly Param[];
}
interface AbiFunction {
  readonly type: "function";
  readonly name: string;
  readonly inputs: readonly Param[];
  readonly outputs?: readonly Param[];
  readonly stateMutability?: string;
}
interface Fragment {
  readonly signature: string;
  readonly selector: string;
  readonly inputs: readonly Param[];
  readonly outputs: readonly Param[];
  readonly stateMutability: string;
}
interface Instance {
  readonly protocol: string;
  readonly abi: string;
  readonly chainId: number;
  readonly address: string;
  readonly error?: string;
  readonly abiErrors?: readonly string[];
  /**
   * selector -> where the deployed code dispatches it: the index of the proxy layer whose code does,
   * `routed:<facet>` for a selector router (diamond), or null when nothing does.
   */
  readonly selectors?: Readonly<Record<string, number | string | null>>;
  /** Ids into `fragments`. */
  readonly verified?: readonly string[];
}
interface Evidence {
  readonly fragments: Readonly<Record<string, Fragment>>;
  readonly instances: readonly Instance[];
}
interface Target {
  readonly roles?: readonly string[];
  /** Narrows `roles` to these chains' deployments, where one role runs different releases. */
  readonly chains?: readonly number[];
  readonly instances?: readonly { chainId: number; address: string }[];
  readonly exempt?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly unverified?: Readonly<Record<string, string>>;
  readonly unverifiable?: string;
}

const targets = JSON.parse(readFileSync(join(FIXTURES, "targets.json"), "utf-8"))
  .protocols as Record<string, Record<string, Target>>;
const evidence = JSON.parse(readFileSync(join(FIXTURES, "evidence.json"), "utf-8")) as Evidence;

const canonical = (p: Param): string =>
  p.type.startsWith("tuple")
    ? `(${(p.components ?? []).map(canonical).join(",")})${p.type.slice("tuple".length)}`
    : p.type;
const signature = (f: { name: string; inputs: readonly Param[] }) =>
  `${f.name}(${f.inputs.map(canonical).join(",")})`;
const outputTypes = (outputs: readonly Param[] | undefined) =>
  `(${(outputs ?? []).map(canonical).join(",")})`;
const normalize = (name: string | undefined) => (name ?? "").replace(/^_+|_+$/g, "").toLowerCase();
/**
 * Struct field names, nested, normalized (`_amount` binds the same object-literal key as `amount`).
 * Top-level parameter names are positional, so they are not compared.
 */
const fieldNames = (params: readonly Param[]): string =>
  params
    .map((p) =>
      p.components
        ? `{${p.components.map((c) => normalize(c.name) + fieldNames([c])).join(",")}}`
        : "",
    )
    .join(",");
/** `view` and `pure` are both STATICCALL-safe, so an interface may declare either. */
const mutability = (m: string | undefined) => (m === "pure" ? "view" : (m ?? "nonpayable"));

const slugs = readdirSync(PROTOCOLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PROTOCOLS, d.name, "abis.ts")))
  .map((d) => d.name)
  .sort();
/** Each protocol's ABI exports, as the module exports them. */
const modules: Record<string, Record<string, unknown>> = Object.fromEntries(
  await Promise.all(
    slugs.map(async (slug) => [slug, await import(`../src/protocols/${slug}/abis.js`)] as const),
  ),
);
/** Each protocol's deployments, from its `addresses.ts`. */
const deployments: Record<
  string,
  readonly { chainId: number; addresses: Record<string, string> }[]
> = Object.fromEntries(
  await Promise.all(
    slugs.map(
      async (slug) =>
        [slug, (await import(`../src/protocols/${slug}/addresses.js`)).deployments] as const,
    ),
  ),
);
const registry: Record<string, Record<string, readonly AbiFunction[]>> = Object.fromEntries(
  slugs.map((slug) => [
    slug,
    Object.fromEntries(
      Object.entries(modules[slug]!)
        .filter(([, value]) => Array.isArray(value))
        .map(([name, value]) => [
          name,
          (value as { type: string }[]).filter(
            (item): item is AbiFunction => item.type === "function",
          ),
        ]),
    ),
  ]),
);

/** Everything wrong with one registry function, against its export's evidence. */
function problemsOf(slug: string, exportName: string, fn: AbiFunction): string[] {
  const target = targets[slug]![exportName]!;
  const sig = signature(fn);
  const selector = toFunctionSelector(sig);
  const problems: string[] = [];
  if (target.unverifiable !== undefined) return problems;

  const instances = evidence.instances.filter((i) => i.protocol === slug && i.abi === exportName);
  let dispatched = 0;
  let verifiedExact = 0;
  for (const instance of instances) {
    const where = `${instance.chainId}:${instance.address}`;
    const exemption = target.exempt?.[sig]?.[where];
    const found: string[] = [];
    if (instance.error !== undefined) {
      found.push(`${where}: ${instance.error}`);
    } else {
      // An explorer that could not answer during capture (`abiErrors`) only costs this deployment
      // its verified fragments: the function still has to be verified on some deployment below.
      const dispatch = instance.selectors?.[selector];
      if (dispatch === undefined) {
        found.push(`${where}: selector ${selector} was not captured — recapture ${slug}`);
      } else if (dispatch === null) {
        found.push(`${where}: the deployed code does not dispatch ${selector}`);
      }
      const overloads = (instance.verified ?? [])
        .map((id) => evidence.fragments[id]!)
        .filter((f) => f.signature.split("(")[0] === fn.name);
      const exact = overloads.find((f) => f.signature === sig);
      if (overloads.length > 0 && exact === undefined) {
        found.push(
          `${where}: the verified ABI has no ${sig} (it declares ${overloads.map((f) => f.signature).join(", ")})`,
        );
      }
      if (exact !== undefined) {
        if (outputTypes(exact.outputs) !== outputTypes(fn.outputs)) {
          found.push(
            `${where}: returns ${outputTypes(exact.outputs)}, the registry declares ${outputTypes(fn.outputs)}`,
          );
        }
        if (mutability(exact.stateMutability) !== mutability(fn.stateMutability)) {
          found.push(
            `${where}: is ${exact.stateMutability}, the registry declares ${fn.stateMutability ?? "nonpayable"}`,
          );
        }
        if (fieldNames(exact.inputs) !== fieldNames(fn.inputs)) {
          found.push(
            `${where}: struct fields ${fieldNames(exact.inputs)}, the registry names ${fieldNames(fn.inputs)}`,
          );
        }
      }
      if (exemption === undefined && found.length === 0) {
        if (dispatch !== null) dispatched++;
        if (exact) verifiedExact++;
      }
    }
    if (exemption !== undefined) {
      if (found.length === 0)
        problems.push(`${where}: stale exemption, it now matches: ${exemption}`);
    } else {
      problems.push(...found);
    }
  }

  if (dispatched === 0 && problems.length === 0) {
    problems.push(
      "no captured deployment dispatches it — add an instance to targets.json and recapture",
    );
  }
  const unverified = target.unverified?.[sig];
  if (verifiedExact === 0 && unverified === undefined && problems.length === 0) {
    problems.push(
      "no verified ABI declares it — find a verified source, or record why none exists under `unverified`",
    );
  }
  if (verifiedExact > 0 && unverified !== undefined) {
    problems.push(`stale \`unverified\` entry, a verified ABI now declares it: ${unverified}`);
  }
  return problems;
}

describe("registry ABI evidence: coverage", () => {
  it("every abis.ts export has a target, and every target names a real export", () => {
    const missing = slugs.flatMap((slug) =>
      Object.keys(registry[slug]!)
        .filter((name) => targets[slug]?.[name] === undefined)
        .map((name) => `${slug}.${name}`),
    );
    // A target for a protocol this tree does not have is one another branch adds (its evidence is
    // captured already); an unknown export of a protocol that IS here is a stale target.
    const unknown = Object.entries(targets).flatMap(([slug, exports]) =>
      registry[slug] === undefined
        ? []
        : Object.keys(exports)
            .filter((name) => registry[slug]![name] === undefined)
            .map((name) => `${slug}.${name}`),
    );
    expect({ missing, unknown }).toEqual({ missing: [], unknown: [] });
  });

  it("every exemption and `unverified` entry names a function the registry declares", () => {
    const orphans: string[] = [];
    for (const [slug, exports] of Object.entries(targets)) {
      if (registry[slug] === undefined) continue; // another branch's protocol, see above
      for (const [name, target] of Object.entries(exports)) {
        const sigs = new Set((registry[slug][name] ?? []).map(signature));
        for (const sig of [
          ...Object.keys(target.exempt ?? {}),
          ...Object.keys(target.unverified ?? {}),
        ]) {
          if (!sigs.has(sig)) orphans.push(`${slug}.${name}: ${sig}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("every deployment of a role a target names is captured, and `chains` drops none", () => {
    const uncaptured: string[] = [];
    for (const slug of slugs) {
      const exports = Object.entries(targets[slug] ?? {});
      const roles = new Set(exports.flatMap(([, target]) => target.roles ?? []));
      for (const d of deployments[slug]!) {
        for (const [role, address] of Object.entries(d.addresses)) {
          // A Solana program id runs no EVM ABI; the capture skips it too.
          if (!roles.has(role) || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
          const where = `${slug}.${role} ${d.chainId}:${address.toLowerCase()}`;
          const bound = exports.filter(
            ([, target]) =>
              target.roles?.includes(role) &&
              (target.chains === undefined || target.chains.includes(d.chainId)),
          );
          if (bound.length === 0) uncaptured.push(`${where}: no export's \`chains\` includes it`);
          for (const [name] of bound) {
            const captured = evidence.instances.some(
              (i) =>
                i.protocol === slug &&
                i.abi === name &&
                i.chainId === d.chainId &&
                i.address === address.toLowerCase(),
            );
            if (!captured) uncaptured.push(`${where}: no ${name} evidence — recapture ${slug}`);
          }
        }
      }
    }
    expect(uncaptured).toEqual([]);
  });

  it("the fixture holds no RPC endpoint or API key", () => {
    const raw = readFileSync(join(FIXTURES, "evidence.json"), "utf-8");
    expect(raw).not.toMatch(/https?:\/\/|apikey|api_key|alchemy|infura/i);
  });

  it("each ABI's JSON twin (what route compilation imports) matches abis.ts", () => {
    const sort = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sort)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, sort(v)]),
            )
          : value;
    const drift: string[] = [];
    for (const slug of slugs) {
      const exports = Object.entries(modules[slug]!).filter(([, value]) => Array.isArray(value));
      const path = (name: string) => join(PROTOCOLS, slug, `${name}.json`);
      // A protocol that ships twins ships one per export, so a new export cannot miss its twin;
      // one that ships none at all (eco-routes) has nothing to compare.
      if (!exports.some(([name]) => existsSync(path(name)))) continue;
      for (const [name, value] of exports) {
        const json = existsSync(path(name))
          ? (JSON.parse(readFileSync(path(name), "utf-8")) as { abi: unknown }).abi
          : undefined;
        if (JSON.stringify(sort(json)) !== JSON.stringify(sort(value))) {
          drift.push(`${slug}/${name}.json`);
        }
      }
    }
    expect(drift).toEqual([]);
  });
});

for (const slug of slugs) {
  describe(`registry ABI evidence: ${slug}`, () => {
    for (const [exportName, fns] of Object.entries(registry[slug]!)) {
      if (targets[slug]?.[exportName] === undefined) continue;
      for (const fn of fns) {
        it(`${exportName}.${signature(fn)}`, () => {
          expect(problemsOf(slug, exportName, fn)).toEqual([]);
        });
      }
    }
  });
}

/**
 * The protocol registry's ABIs, checked against the contracts they describe.
 *
 * A registry ABI is the FULL ABI of the deployed contract it speaks for: the union of what its
 * deployments' verified ABIs declare (`scripts/gen-registry-abis.mjs`), less what cannot be exposed,
 * each omission listed with why in `fixtures/registry-abi/omitted.json`. For every function an
 * `abis.ts` export declares:
 *   - some captured deployment must dispatch its selector (proxies, clones and diamonds resolved) —
 *     a wrong parameter type is a different selector;
 *   - where a verified ABI exists (Sourcify, Blockscout, a keyless Etherscan-compatible API), the
 *     outputs, the state mutability and the struct field names must match it — a selector cannot
 *     catch a wrong output type, and a `view` that writes state reverts under STATICCALL;
 *   - a role's deployment that does not run it as declared (no dispatch, or a verified declaration
 *     that differs) must have it WITHHELD on its chain (`contracts.generated.ts`), so a program
 *     compiled for that chain cannot call it; and one withheld must be one the deployment lacks;
 *   - an interface's instance (or a role export's representative `instances`) whose verified ABI
 *     declares it otherwise is an `exempt` entry with its reason.
 * And every function, event and error the export's deployments verifiably declare is either in the
 * registry ABI or in `omitted.json`: nothing is trimmed silently. A function left out for its name
 * or its arity alone carries its ABI item there (`function`) and is called by its signature
 * through the namespace (`ContractLink.bySignature`): it is checked like every function above, its
 * per-chain withholding `bySignatureWithheld`, and no deployment serves it declared otherwise.
 *
 * OFFLINE. The evidence is `fixtures/registry-abi/evidence.json`, captured by
 * `scripts/capture-registry-abi.mjs` only when asked to (see CLAUDE.md). A registry edit the
 * fixture does not cover fails here, naming what to recapture, instead of passing unchecked.
 *
 * For every event and custom error an export declares: some deployment's code must carry it (an
 * event's topic a PUSH32 before its LOG, an anonymous one the LOG its indexed parameters take, an
 * error's selector a constant before its REVERT), `unverified` or not; each deployment whose code
 * does not is recorded against it under `uncarried` in `omitted.json`; a verified ABI must declare
 * it with the same `indexed` flags and anonymity (a topic cannot tell an indexed parameter from one
 * in the data, and a wrong flag decodes no log), or, where none does, an `unverified` entry say why.
 * A real log of each event a target lists under `logs` must decode with the registry's declaration.
 *
 * A router that names one selector's facet at a time is asked about every function of its
 * inventory (`reference/index.json` `inventories`, each facet pinned by sha256): each facet must be
 * reached by some deployment or its target say why under `unresolved`. A deployment whose verified
 * ABI is carried from a capture that kept only the registry's names (`carried.partial`) is listed
 * in `omitted.json` under `partial`.
 *
 * `fixtures/registry-abi/targets.json` says which deployments evidence which export, and records
 * every exception with its reason: `exempt`, `unverified` (no verified source, so only the selector
 * is checked; a reference interface's function names its source) and `unverifiable` (nothing
 * on-chain can evidence the export at all). An exception that no longer applies fails too, so the
 * list cannot rot. It also records `required` overloads: a signature some consumer binds, which the
 * registry must keep declaring.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeEventLog,
  getAddress,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
} from "viem";

import { CONTRACT_LINKS } from "../src/descriptors/contracts.generated.js";

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
/** A declared event or custom error: the parameters only, an event's flagged `indexed`. */
interface AbiMark {
  readonly type: "event" | "error";
  readonly name: string;
  /** An anonymous event: its log carries no topic0, only its indexed parameters. */
  readonly anonymous?: boolean;
  readonly inputs: readonly (Param & { readonly indexed?: boolean })[];
}
/** A verified fragment. A function's has no `type`; an event's or error's carries it. */
interface Fragment {
  readonly type?: "event" | "error";
  readonly signature: string;
  readonly selector?: string;
  readonly topic0?: string;
  readonly anonymous?: boolean;
  readonly inputs: readonly (Param & { readonly indexed?: boolean })[];
  readonly outputs?: readonly Param[];
  readonly stateMutability?: string;
}
/** A log as the node returned it, captured for one event an export declares. */
interface CapturedLog {
  readonly protocol: string;
  readonly abi: string;
  /** The event's signature, `Name(type,…)`. */
  readonly event: string;
  readonly chainId: number;
  readonly address: string;
  readonly blockNumber: number;
  readonly transactionHash: string;
  readonly topics: readonly `0x${string}`[];
  readonly data: `0x${string}`;
}
interface Instance {
  readonly protocol: string;
  readonly abi: string;
  readonly chainId: number;
  readonly address: string;
  /** The addresses.ts role the deployment is, for a role's deployment; absent for `instances`. */
  readonly role?: string;
  readonly error?: string;
  readonly abiErrors?: readonly string[];
  /**
   * selector -> where the deployed code dispatches it: the index of the proxy layer whose code does,
   * `routed:<facet>` for a selector router (diamond), or null when nothing does.
   */
  readonly selectors?: Readonly<Record<string, number | string | null>>;
  /** Topic -> where the code carries it, as `selectors`. */
  readonly events?: Readonly<Record<string, number | string | null>>;
  /** Selector -> where the code carries it. */
  readonly errors?: Readonly<Record<string, number | string | null>>;
  /** Ids into `fragments`. */
  readonly verified?: readonly string[];
  /**
   * How the deployment routes selectors to facets: `facets()` for an EIP-2535 loupe's whole table,
   * else each per-selector lookup it answers (`getImplementation(bytes4)`, …); empty for none.
   */
  readonly router?: readonly string[];
  /** For an export with a router inventory: how many facets it has, and which this one reached. */
  readonly inventory?: { readonly facets: number; readonly resolved: readonly string[] };
  /** Where each layer's verified ABI came from; `carried` when kept from an earlier capture. */
  readonly abiSources?: readonly {
    readonly address: string;
    readonly carried?: unknown;
    readonly sameCodeAs?: string;
  }[];
}
interface Evidence {
  readonly fragments: Readonly<Record<string, Fragment>>;
  readonly instances: readonly Instance[];
  readonly logs?: readonly CapturedLog[];
}
interface Target {
  readonly roles?: readonly string[];
  /** Narrows `roles` to these chains' deployments, where one role runs different releases. */
  readonly chains?: readonly number[];
  readonly instances?: readonly { chainId: number; address: string }[];
  /** Keyed by a function's signature, or `event <signature>` / `error <signature>`. */
  readonly exempt?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly unverified?: Readonly<Record<string, string>>;
  readonly unverifiable?: string;
  /** Signature -> the consumer that binds it. Removing one from `abis.ts` fails the suite. */
  readonly required?: Readonly<Record<string, string>>;
  /** Signature -> why it is the overload kept of those that take as many arguments. */
  readonly overloads?: Readonly<Record<string, string>>;
  /** An interface whose ABI is its reference interface alone, and why. */
  readonly standard?: string;
  /** An interface whose ABI is what every instance declares alike, and why. */
  readonly common?: string;
  /** Event signatures whose real log the capture records. */
  readonly logs?: readonly string[];
  readonly delegates?: readonly string[];
  /** On a role's export: why its contract is `<Protocol>.<method>(…)`'s where there are several. */
  readonly default?: string;
  /** A router inventory's facet no deployment reaches -> why. */
  readonly unresolved?: Readonly<Record<string, string>>;
}
interface Omitted {
  readonly exports: Readonly<
    Record<
      string,
      readonly { signature: string; reason: string; function?: AbiFunction | undefined }[]
    >
  >;
  /** `<slug>.<Export>` -> `<chainId>:<address>` -> the shipped events and errors its code lacks. */
  readonly uncarried: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** `<slug>.<Export>` -> the deployments whose verified ABI is a partial earlier capture's. */
  readonly partial: Readonly<
    Record<string, readonly { deployment: string; source: string; date: string }[]>
  >;
}
interface ReferenceIndex {
  readonly exports: Readonly<
    Record<string, readonly { file: string; source: string; sha256: string }[]>
  >;
  /** `<slug>.<Export>` -> a per-selector router's facets, each its maker's interface; and a note. */
  readonly inventories: Readonly<
    Record<
      string,
      | string
      | {
          readonly facets: Readonly<
            Record<string, { file: string; source: string; sha256: string }>
          >;
        }
    >
  >;
}

const targets = JSON.parse(readFileSync(join(FIXTURES, "targets.json"), "utf-8"))
  .protocols as Record<string, Record<string, Target>>;
const evidence = JSON.parse(readFileSync(join(FIXTURES, "evidence.json"), "utf-8")) as Evidence;
const omittedFile = JSON.parse(readFileSync(join(FIXTURES, "omitted.json"), "utf-8")) as Omitted;
const omitted = omittedFile.exports;
const referenceIndex = JSON.parse(
  readFileSync(join(FIXTURES, "reference", "index.json"), "utf-8"),
) as ReferenceIndex;
const reference = (key: string): readonly (AbiFunction | AbiMark)[] =>
  (referenceIndex.exports[key] ?? []).flatMap(
    ({ file }) =>
      JSON.parse(readFileSync(join(FIXTURES, "reference", file), "utf-8")) as (
        AbiFunction | AbiMark
      )[],
  );
/** Each per-selector router's inventory (`reference/index.json` `inventories`): its facets. */
const inventories = Object.entries(referenceIndex.inventories ?? {}).flatMap(([key, value]) =>
  typeof value === "string" ? [] : [[key, value.facets] as const],
);

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
/** Each export's events and custom errors. */
const marks: Record<string, Record<string, readonly AbiMark[]>> = Object.fromEntries(
  slugs.map((slug) => [
    slug,
    Object.fromEntries(
      Object.entries(modules[slug]!)
        .filter(([, value]) => Array.isArray(value))
        .map(([name, value]) => [
          name,
          (value as { type: string }[]).filter(
            (item): item is AbiMark => item.type === "event" || item.type === "error",
          ),
        ]),
    ),
  ]),
);
/** How a target's exception maps name an event or an error, beside functions' bare signatures. */
const markKey = (item: AbiMark): string => `${item.type} ${signature(item)}`;
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

const instancesOf = (slug: string, exportName: string) =>
  evidence.instances.filter((i) => i.protocol === slug && i.abi === exportName);
const fragmentsOf = (instance: Instance) =>
  (instance.verified ?? []).map((id) => evidence.fragments[id]!);
const where = (instance: Instance) => `${instance.chainId}:${instance.address}`;

/** The contract a role's deployment is: the link of its role and export on its chain. */
function linkOf(slug: string, exportName: string, instance: Instance) {
  return CONTRACT_LINKS.find(
    (l) =>
      l.protocol === slug &&
      "abiExport" in l &&
      "roleKey" in l &&
      l.abiExport === exportName &&
      l.roleKey === instance.role &&
      (!("chains" in l) || l.chains.some((chainId: number) => chainId === instance.chainId)),
  );
}

/** The functions a role's deployment on a chain withholds, by the contract the role is: of its
 *  ABI, or with `bySignature`, of those it calls by signature only. */
function withheldOn(
  slug: string,
  exportName: string,
  instance: Instance,
  bySignature = false,
): ReadonlySet<string> {
  const link = linkOf(slug, exportName, instance);
  if (link === undefined) return new Set();
  const byChain: Readonly<Record<number, readonly string[]>> | undefined = bySignature
    ? "bySignatureWithheld" in link
      ? link.bySignatureWithheld
      : undefined
    : "withheld" in link
      ? link.withheld
      : undefined;
  return new Set(byChain?.[instance.chainId] ?? []);
}

/** The functions `slug`'s `exportName` leaves out for their name or arity alone, which a program
 *  calls by signature (`omitted.json` entries carrying their ABI item). */
const bySignatureOf = (slug: string, exportName: string): readonly AbiFunction[] =>
  (omitted[`${slug}.${exportName}`] ?? []).flatMap((o) =>
    o.function === undefined ? [] : [o.function],
  );

/** The functions a role's deployment on a chain is served as it declares them, by signature. */
function shapedOn(
  slug: string,
  exportName: string,
  instance: Instance,
): ReadonlyMap<string, AbiFunction> {
  const link = linkOf(slug, exportName, instance);
  if (link === undefined || !("shapes" in link)) return new Map();
  const byChain: Readonly<Record<number, readonly AbiFunction[]>> = link.shapes;
  return new Map((byChain[instance.chainId] ?? []).map((f) => [signature(f), f]));
}

/** A declaration whole: its parameters' names, types and fields, and its mutability. */
const params = (list: readonly Param[] | undefined): unknown[] =>
  (list ?? []).map((p) => ({
    name: p.name ?? "",
    type: p.type,
    ...(p.components ? { components: params(p.components) } : {}),
  }));
const declared = (f: Pick<Fragment, "inputs" | "outputs" | "stateMutability">): string =>
  JSON.stringify([params(f.inputs), params(f.outputs), f.stateMutability ?? "nonpayable"]);
const isRead = (m: string | undefined): boolean => mutability(m) === "view";

/**
 * Everything wrong with one registry function, against its export's evidence: one of its ABI, or
 * with `bySignature`, one it calls by signature only, which no chain serves declared otherwise.
 */
function problemsOf(
  slug: string,
  exportName: string,
  fn: AbiFunction,
  bySignature = false,
): string[] {
  const target = targets[slug]![exportName]!;
  const sig = signature(fn);
  const selector = toFunctionSelector(sig);
  const problems: string[] = [];
  if (target.unverifiable !== undefined) return problems;
  const everyInstance = target.standard !== undefined || target.common !== undefined;

  let dispatched = 0;
  let verifiedExact = 0;
  for (const instance of instancesOf(slug, exportName)) {
    const at = where(instance);
    const exemption = target.exempt?.[sig]?.[at];
    if (instance.error !== undefined) {
      problems.push(`${at}: ${instance.error}`);
      continue;
    }
    // An explorer that could not answer during capture (`abiErrors`) only costs this deployment
    // its verified fragments: the function still has to be verified on some deployment below.
    const dispatch = instance.selectors?.[selector];
    if (dispatch === undefined) {
      problems.push(`${at}: selector ${selector} was not captured — recapture ${slug}`);
      continue;
    }
    const lacks: string[] = [];
    if (dispatch === null) lacks.push(`the deployed code does not dispatch ${selector}`);
    else dispatched++;
    const overloads = fragmentsOf(instance).filter(
      (f) => f.type === undefined && f.signature.split("(")[0] === fn.name,
    );
    const exact = overloads.find((f) => f.signature === sig);
    if (overloads.length > 0 && exact === undefined) {
      lacks.push(
        `the verified ABI has no ${sig} (it declares ${overloads.map((f) => f.signature).join(", ")})`,
      );
    }
    if (exact !== undefined) {
      const before = lacks.length;
      if (outputTypes(exact.outputs) !== outputTypes(fn.outputs)) {
        lacks.push(
          `returns ${outputTypes(exact.outputs)}, the registry declares ${outputTypes(fn.outputs)}`,
        );
      }
      if (mutability(exact.stateMutability) !== mutability(fn.stateMutability)) {
        lacks.push(
          `is ${exact.stateMutability}, the registry declares ${fn.stateMutability ?? "nonpayable"}`,
        );
      }
      if (fieldNames(exact.inputs) !== fieldNames(fn.inputs)) {
        lacks.push(
          `struct fields ${fieldNames(exact.inputs)}, the registry names ${fieldNames(fn.inputs)}`,
        );
      }
      if (lacks.length === before) verifiedExact++;
    }

    if (instance.role !== undefined) {
      // A role's deployment: one that dispatches the selector and declares this signature
      // otherwise is served its declaration on its chain, unless that would mix reads and writes
      // among the name's overloads; whatever else it lacks is withheld there; and only that.
      const withheld = withheldOn(slug, exportName, instance, bySignature).has(sig);
      const shaped = bySignature ? undefined : shapedOn(slug, exportName, instance).get(sig);
      const mixes =
        exact !== undefined &&
        registry[slug]![exportName]!.some(
          (other) =>
            other.name === fn.name &&
            signature(other) !== sig &&
            isRead(other.stateMutability) !== isRead(exact.stateMutability),
        );
      const served =
        !bySignature && dispatch !== null && exact !== undefined && lacks.length > 0 && !mixes;
      if (exemption !== undefined) {
        problems.push(
          `${at}: stale exemption, a role's deployment withholds or declares instead: ${exemption}`,
        );
      } else if (served) {
        if (withheld) {
          problems.push(
            `${at}: withheld on chain ${instance.chainId}, but its deployment runs it as it declares it`,
          );
        }
        if (shaped === undefined) {
          problems.push(
            ...lacks.map((lack) => `${at}: ${lack}, and it is not served there as declared`),
          );
        } else if (declared(shaped) !== declared(exact)) {
          problems.push(
            `${at}: served on chain ${instance.chainId} as ${declared(shaped)}, but its deployment declares ${declared(exact)}`,
          );
        }
      } else {
        if (shaped !== undefined) {
          problems.push(
            `${at}: served on chain ${instance.chainId} as its deployment declares it, but it ${lacks.length > 0 ? "must be withheld there" : "runs the registry's declaration"}`,
          );
        }
        if (lacks.length > 0 && !withheld) {
          problems.push(...lacks.map((lack) => `${at}: ${lack}, and it is not withheld there`));
        } else if (lacks.length === 0 && withheld) {
          problems.push(`${at}: withheld on chain ${instance.chainId}, but its deployment runs it`);
        }
      }
      continue;
    }
    // An interface's example: one that does not dispatch it is another release of the interface,
    // unless every instance must (a standard's, a `common` interface's); one that declares it
    // otherwise is an exemption.
    const found = lacks.filter(
      (lack) => everyInstance || !lack.startsWith("the deployed code does not dispatch"),
    );
    if (exemption !== undefined) {
      if (found.length === 0) problems.push(`${at}: stale exemption, it now matches: ${exemption}`);
    } else {
      problems.push(...found.map((lack) => `${at}: ${lack}`));
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
  return problems.map((problem) => `${sig}: ${problem}`);
}

/** An event's parameters as `indexed`-or-not, in order: what decides which of them a log's topics carry. */
const indexing = (inputs: AbiMark["inputs"]): string =>
  inputs.map((p) => `${p.indexed ? "indexed " : ""}${canonical(p)}`).join(", ");

/**
 * Everything wrong with one registry event or custom error, against its export's evidence. Some
 * deployment's code must carry it, `unverified` or not (a contract whose code carries none never
 * logs or reverts with it), and each deployment's code that does not is recorded against it under
 * `uncarried` in `omitted.json`, and only such a one.
 */
function markProblemsOf(slug: string, exportName: string, item: AbiMark): string[] {
  const target = targets[slug]![exportName]!;
  const sig = signature(item);
  const key = markKey(item);
  const mark = item.type === "event" ? toEventSelector(sig) : toFunctionSelector(sig);
  const problems: string[] = [];
  if (target.unverifiable !== undefined) return problems;

  let carried = 0;
  let verifiedExact = 0;
  for (const instance of instancesOf(slug, exportName)) {
    const at = where(instance);
    const exemption = target.exempt?.[key]?.[at];
    const found: string[] = [];
    if (instance.error !== undefined) {
      found.push(`${at}: ${instance.error}`);
    } else {
      const located = (item.type === "event" ? instance.events : instance.errors)?.[mark];
      // A shipped one a deployment's code does not carry is recorded against it in omitted.json.
      const recorded = (omittedFile.uncarried?.[`${slug}.${exportName}`]?.[at] ?? []).includes(key);
      if (located === undefined) {
        found.push(`${at}: ${item.type} ${mark} was not captured — recapture ${slug}`);
      } else if (located !== null) {
        carried++;
        if (recorded) found.push(`${at}: recorded under \`uncarried\`, but its code carries it`);
      } else if (!recorded) {
        found.push(
          `${at}: its code does not carry ${mark}, and omitted.json does not record it under \`uncarried\``,
        );
      }
      const overloads = fragmentsOf(instance).filter(
        (f) => f.type === item.type && f.signature.split("(")[0] === item.name,
      );
      const exact = overloads.find((f) => f.signature === sig);
      // Another declaration of the name is another event or error: only the same one disagrees.
      if (exact !== undefined && item.type === "event") {
        if (indexing(exact.inputs) !== indexing(item.inputs)) {
          found.push(
            `${at}: the verified ${sig} is (${indexing(exact.inputs)}), the registry declares (${indexing(item.inputs)})`,
          );
        }
        // An anonymous event's log has no topic0: declared otherwise, no log of it decodes.
        if (Boolean(exact.anonymous) !== Boolean(item.anonymous)) {
          found.push(
            `${at}: the verified ${sig} is ${exact.anonymous ? "" : "not "}anonymous, the registry declares it ${item.anonymous ? "" : "not "}anonymous`,
          );
        }
      }
      if (exact !== undefined && found.length === 0) verifiedExact++;
    }
    if (exemption !== undefined) {
      if (found.length === 0) problems.push(`${at}: stale exemption, it now matches: ${exemption}`);
    } else {
      problems.push(...found);
    }
  }

  if (carried === 0 && problems.length === 0) {
    problems.push(
      "no captured deployment's code carries it — leave it out (`gen-registry-abis.mjs`), or add an instance that does and recapture",
    );
  }
  const unverified = target.unverified?.[key];
  if (verifiedExact === 0 && unverified === undefined && problems.length === 0) {
    problems.push(
      "no verified ABI declares it — find a verified source, or record why none exists under `unverified`",
    );
  }
  if (verifiedExact > 0 && unverified !== undefined) {
    problems.push(`stale \`unverified\` entry, a verified ABI now declares it: ${unverified}`);
  }
  return problems.map((problem) => `${key}: ${problem}`);
}

/**
 * What the export's deployments declare that its registry ABI does not, and `omitted.json` does not
 * list: a silent trim. And what `omitted.json` lists that the registry declares after all.
 */
function untold(slug: string, exportName: string): string[] {
  const target = targets[slug]![exportName]!;
  if (target.unverifiable !== undefined) return [];
  const instances = instancesOf(slug, exportName).filter((i) => i.error === undefined);
  const declared = new Set([
    ...registry[slug]![exportName]!.map(signature),
    ...marks[slug]![exportName]!.map(markKey),
  ]);
  const listed = new Set((omitted[`${slug}.${exportName}`] ?? []).map((o) => o.signature));
  /** Each function's, event's and error's key, and a function's selector. */
  const offered = new Map<string, string | undefined>();
  const offer = (item: AbiFunction | AbiMark) =>
    item.type === "function"
      ? offered.set(signature(item), toFunctionSelector(signature(item)))
      : offered.set(markKey(item), undefined);
  const ref = reference(`${slug}.${exportName}`);
  if (target.standard !== undefined) {
    for (const item of ref) offer(item);
  } else {
    for (const instance of instances) {
      for (const f of fragmentsOf(instance)) {
        if (f.type === undefined) offered.set(f.signature, f.selector);
        else offered.set(`${f.type} ${f.signature}`, undefined);
      }
    }
    for (const item of ref) if (item.type === "function") offer(item);
  }
  const declaredSelectors = new Set<string>(
    registry[slug]![exportName]!.map((f) => toFunctionSelector(signature(f))),
  );
  const problems: string[] = [];
  for (const [sig, selector] of offered) {
    if (declared.has(sig) || listed.has(sig)) continue;
    // Another declaration of a selector the registry declares is the same function.
    if (selector !== undefined && declaredSelectors.has(selector)) continue;
    problems.push(`${sig}: declared by its deployments, in neither the ABI nor omitted.json`);
  }
  for (const sig of listed) {
    if (declared.has(sig)) problems.push(`${sig}: listed as omitted, and declared`);
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

  it("every exemption, `unverified`, `required`, `overloads` and `logs` entry names what the registry declares", () => {
    const orphans: string[] = [];
    for (const [slug, exports] of Object.entries(targets)) {
      if (registry[slug] === undefined) continue; // another branch's protocol, see above
      for (const [name, target] of Object.entries(exports)) {
        const sigs = new Set([
          ...(registry[slug][name] ?? []).map(signature),
          ...(marks[slug][name] ?? []).map(markKey),
        ]);
        // A function called by its signature is checked like the ABI's, exceptions included.
        const checked = new Set([...sigs, ...bySignatureOf(slug, name).map(signature)]);
        for (const sig of [
          ...Object.keys(target.exempt ?? {}),
          ...Object.keys(target.unverified ?? {}),
        ]) {
          if (!checked.has(sig)) orphans.push(`${slug}.${name}: ${sig}`);
        }
        for (const sig of [
          ...Object.keys(target.required ?? {}),
          ...Object.keys(target.overloads ?? {}),
          ...(target.logs ?? []).map((event) => `event ${event}`),
        ]) {
          if (!sigs.has(sig)) orphans.push(`${slug}.${name}: ${sig}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("`standard` and `common` are on interfaces only, never both, a standard has its reference, and a `default` is one role's, one per protocol", () => {
    const wrong: string[] = [];
    for (const [slug, exports] of Object.entries(targets)) {
      const defaults = Object.entries(exports).filter(([, target]) => target.default !== undefined);
      if (defaults.length > 1) wrong.push(`${slug}: ${defaults.length} exports are its default`);
      for (const [name, target] of Object.entries(exports)) {
        if (target.default !== undefined && target.roles?.length !== 1)
          wrong.push(`${slug}.${name}: a default binds exactly one role`);
        if (target.standard === undefined && target.common === undefined) continue;
        if ((target.roles ?? []).length > 0) wrong.push(`${slug}.${name}: a role is bound to it`);
        if (target.standard !== undefined && target.common !== undefined)
          wrong.push(`${slug}.${name}: both`);
        if (target.standard !== undefined && reference(`${slug}.${name}`).length === 0)
          wrong.push(`${slug}.${name}: no reference interface`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every reference interface is the file its index pins, and names an export", () => {
    const wrong: string[] = [];
    for (const [key, files] of Object.entries(referenceIndex.exports)) {
      const [slug, name] = key.split(".");
      if (registry[slug!] !== undefined && registry[slug!]![name!] === undefined)
        wrong.push(`${key}: no such export`);
      for (const { file, sha256 } of files) {
        const digest = createHash("sha256")
          .update(readFileSync(join(FIXTURES, "reference", file)))
          .digest("hex");
        if (digest !== sha256) wrong.push(`${key}: ${file} is not the pinned file`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every router inventory is the files its index pins, and each of its facets is reached by some deployment or says why under `unresolved`", () => {
    const wrong: string[] = [];
    for (const [key, facets] of inventories) {
      const [slug, name] = key.split(".") as [string, string];
      if (registry[slug] === undefined) continue; // another branch's protocol, see above
      if (registry[slug][name] === undefined) {
        wrong.push(`${key}: no such export`);
        continue;
      }
      for (const [facet, { file, sha256 }] of Object.entries(facets)) {
        const digest = createHash("sha256")
          .update(readFileSync(join(FIXTURES, "reference", file)))
          .digest("hex");
        if (digest !== sha256) wrong.push(`${key}: ${facet}'s ${file} is not the pinned file`);
      }
      const count = Object.keys(facets).length;
      const rows = instancesOf(slug, name).filter((i) => i.error === undefined);
      for (const row of rows) {
        if (row.inventory?.facets !== count) {
          wrong.push(
            `${key} ${where(row)}: captured against ${row.inventory?.facets ?? "no"} inventory facets, the inventory has ${count} — recapture ${slug}`,
          );
        }
        for (const facet of row.inventory?.resolved ?? []) {
          if (facets[facet] === undefined) {
            wrong.push(`${key} ${where(row)}: reached ${facet}, no facet of the inventory`);
          }
        }
      }
      const reached = new Set(rows.flatMap((row) => row.inventory?.resolved ?? []));
      const unresolved = targets[slug]?.[name]?.unresolved ?? {};
      for (const facet of Object.keys(facets)) {
        const why = unresolved[facet];
        if (reached.has(facet)) {
          if (why !== undefined) {
            wrong.push(`${key}: stale \`unresolved\` entry, a deployment reaches ${facet}: ${why}`);
          }
        } else if (why === undefined) {
          wrong.push(
            `${key}: no deployment reaches ${facet} — add one that does, or say why under \`unresolved\``,
          );
        }
      }
      for (const facet of Object.keys(unresolved)) {
        if (facets[facet] === undefined) {
          wrong.push(`${key}: \`unresolved\` names ${facet}, no facet of the inventory`);
        }
      }
    }
    for (const [slug, exports] of Object.entries(targets)) {
      for (const [name, target] of Object.entries(exports)) {
        if (
          target.unresolved !== undefined &&
          !inventories.some(([key]) => key === `${slug}.${name}`)
        )
          wrong.push(`${slug}.${name}: \`unresolved\` with no inventory`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every deployment records how it routes selectors, and a per-selector router has an inventory", () => {
    const wrong: string[] = [];
    const inventoried = new Set(inventories.map(([key]) => key));
    for (const row of evidence.instances) {
      if (row.error !== undefined) continue;
      const at = `${row.protocol}.${row.abi} ${where(row)}`;
      if (!Array.isArray(row.router)) {
        wrong.push(`${at}: no \`router\` recorded — recapture ${row.protocol}`);
        continue;
      }
      // A lookup that names one selector's facet at a time leaves a facet no candidate reaches
      // unseen: what an inventory is for. A loupe's `facets()` lists the whole table, and an EIP-2535
      // diamond's `facetAddress(bytes4)` comes with `facetAddresses()`, which lists every facet.
      const perSelector = row.router.filter(
        (lookup) => lookup !== "facets()" && lookup !== "facetAddress(bytes4)",
      );
      if (perSelector.length > 0 && !inventoried.has(`${row.protocol}.${row.abi}`)) {
        wrong.push(
          `${at}: routes by ${perSelector.join(", ")}, and reference/index.json has no inventory of its facets`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every `uncarried` record names a captured deployment and an event or error its export declares", () => {
    const wrong: string[] = [];
    for (const [key, byDeployment] of Object.entries(omittedFile.uncarried ?? {})) {
      const [slug, name] = key.split(".") as [string, string];
      if (registry[slug] === undefined) continue; // another branch's protocol, see above
      const declared = new Set((marks[slug]?.[name] ?? []).map(markKey));
      for (const [deployment, keys] of Object.entries(byDeployment)) {
        const captured = instancesOf(slug, name).some(
          (i) => i.error === undefined && where(i) === deployment,
        );
        if (!captured) wrong.push(`${key} ${deployment}: no captured deployment`);
        for (const k of keys) {
          if (!declared.has(k)) wrong.push(`${key} ${deployment}: ${k} is not declared`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every ABI carried from an earlier capture says when and whether it is partial, and omitted.json lists each partial one", () => {
    const wrong: string[] = [];
    const partial = new Set<string>();
    for (const row of evidence.instances) {
      if (targets[row.protocol]?.[row.abi]?.unverifiable !== undefined) continue;
      for (const source of row.abiSources ?? []) {
        if (source.carried === undefined) continue;
        const carried = source.carried as { date?: unknown; partial?: unknown } | null;
        if (
          typeof carried !== "object" ||
          carried === null ||
          typeof carried.date !== "string" ||
          typeof carried.partial !== "boolean"
        ) {
          wrong.push(
            `${row.protocol}.${row.abi} ${where(row)} ${source.address}: \`carried\` is not { date, partial } — recapture ${row.protocol}`,
          );
          continue;
        }
        if (carried.partial) {
          partial.add(`${row.protocol}.${row.abi} ${where(row)} ${source.address} ${carried.date}`);
        }
      }
    }
    const listed = new Set(
      Object.entries(omittedFile.partial ?? {}).flatMap(([key, list]) =>
        list.map((p) => `${key} ${p.deployment} ${p.source} ${p.date}`),
      ),
    );
    for (const p of partial) {
      if (!listed.has(p)) wrong.push(`${p}: a partial carry omitted.json does not list`);
    }
    for (const p of listed) {
      if (!partial.has(p)) wrong.push(`${p}: listed in omitted.json as a partial carry, not one`);
    }
    expect(wrong).toEqual([]);
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
          const at = `${slug}.${role} ${d.chainId}:${address.toLowerCase()}`;
          const bound = exports.filter(
            ([, target]) =>
              target.roles?.includes(role) &&
              (target.chains === undefined || target.chains.includes(d.chainId)),
          );
          if (bound.length === 0) uncaptured.push(`${at}: no export's \`chains\` includes it`);
          for (const [name] of bound) {
            const captured = evidence.instances.some(
              (i) =>
                i.protocol === slug &&
                i.abi === name &&
                i.chainId === d.chainId &&
                i.address === address.toLowerCase(),
            );
            if (!captured) uncaptured.push(`${at}: no ${name} evidence — recapture ${slug}`);
          }
        }
      }
    }
    expect(uncaptured).toEqual([]);
  });

  it("every EVM address a protocol's addresses.ts records is EIP-55 checksummed", () => {
    // viem's getAddress, and every wallet that checks the case, refuses a mixed-case address whose
    // checksum is wrong; the generated chain and protocol pages print these as written.
    const wrong = slugs.flatMap((slug) =>
      deployments[slug]!.flatMap((d) =>
        Object.entries(d.addresses)
          .filter(([, address]) => /^0x[0-9a-fA-F]{40}$/.test(address))
          .filter(([, address]) => getAddress(address.toLowerCase()) !== address)
          .map(([role, address]) => `${slug}.${role} ${d.chainId}: ${address}`),
      ),
    );
    expect(wrong).toEqual([]);
  });

  it("the fixture holds no RPC endpoint or API key", () => {
    for (const file of ["evidence.json", "omitted.json"]) {
      const raw = readFileSync(join(FIXTURES, file), "utf-8");
      expect(raw).not.toMatch(/https?:\/\/|apikey|api_key|alchemy|infura/i);
    }
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

  it("the registry ABIs, their twins and omitted.json are what the evidence generates (`gen-registry-abis.mjs --check`)", () => {
    expect(() =>
      execFileSync(process.execPath, [join(SDK, "scripts", "gen-registry-abis.mjs"), "--check"], {
        cwd: SDK,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("a function is called by its signature exactly where omitted.json leaves it out for its name or arity, through every contract of its export", () => {
    const wrong: string[] = [];
    for (const [key, entries] of Object.entries(omitted)) {
      const [slug, name] = key.split(".") as [string, string];
      if (registry[slug] === undefined) continue; // another branch's protocol, see above
      for (const entry of entries) {
        const called = entry.reason.endsWith("called by its signature");
        if (called !== (entry.function !== undefined)) {
          wrong.push(`${key} ${entry.signature}: its reason and its \`function\` disagree`);
        }
        if (entry.function !== undefined && signature(entry.function) !== entry.signature) {
          wrong.push(`${key} ${entry.signature}: its \`function\` is ${signature(entry.function)}`);
        }
      }
      const expected = bySignatureOf(slug, name).map(signature);
      for (const link of CONTRACT_LINKS) {
        if (link.protocol !== slug || !("abiExport" in link) || link.abiExport !== name) continue;
        if (link.kind === "address-only") continue;
        const carried: readonly { name: string; inputs: readonly Param[] }[] =
          "bySignature" in link ? link.bySignature : [];
        if (JSON.stringify(carried.map(signature)) !== JSON.stringify(expected)) {
          wrong.push(
            `${slug}.${link.contract}: called by signature ${JSON.stringify(carried.map(signature))}, omitted.json leaves out ${JSON.stringify(expected)}`,
          );
        }
      }
    }
    for (const link of CONTRACT_LINKS) {
      if (!("bySignature" in link) || !("abiExport" in link)) continue;
      if (omitted[`${link.protocol}.${link.abiExport}`] === undefined) {
        wrong.push(`${link.protocol}.${link.contract}: called by signature, nothing left out`);
      }
    }
    expect(wrong).toEqual([]);
    // The 21 overloads taking as many arguments as the one called by name, and the 2 functions
    // whose name the accessors keep (`available()`), over 23 exports.
    expect(
      Object.values(omitted)
        .flat()
        .filter((o) => o.function !== undefined),
    ).toHaveLength(23);
  });
});

for (const slug of slugs) {
  describe(`registry ABI evidence: ${slug}`, () => {
    for (const exportName of Object.keys(registry[slug]!)) {
      if (targets[slug]?.[exportName] === undefined) continue;
      it(`${exportName}: every function`, () => {
        expect(
          registry[slug]![exportName]!.flatMap((fn) => problemsOf(slug, exportName, fn)),
        ).toEqual([]);
      });
      it(`${exportName}: every event and error`, () => {
        expect(
          (marks[slug]![exportName] ?? []).flatMap((item) =>
            markProblemsOf(slug, exportName, item),
          ),
        ).toEqual([]);
      });
      it(`${exportName}: nothing its deployments declare is left out unlisted`, () => {
        expect(untold(slug, exportName)).toEqual([]);
      });
      const bySignature = bySignatureOf(slug, exportName);
      if (bySignature.length > 0) {
        it(`${exportName}: every function called by its signature`, () => {
          expect(bySignature.flatMap((fn) => problemsOf(slug, exportName, fn, true))).toEqual([]);
        });
      }
    }
  });
}

describe("registry ABI evidence: real logs decode with the registry's events", () => {
  const logs = evidence.logs ?? [];

  it("the capture holds a log of every event a target lists under `logs`", () => {
    const wanted = Object.entries(targets).flatMap(([slug, exports]) =>
      Object.entries(exports).flatMap(([name, target]) =>
        (target.logs ?? []).map((event) => `${slug}.${name} ${event}`),
      ),
    );
    expect(wanted.length).toBeGreaterThan(0);
    expect(
      wanted.filter(
        (want) => !logs.some((log) => `${log.protocol}.${log.abi} ${log.event}` === want),
      ),
    ).toEqual([]);
  });

  it.each(logs.map((log) => [`${log.protocol}.${log.abi} ${log.event}`, log] as const))(
    "%s",
    (_name, log) => {
      // A protocol another branch adds has no module here: its logs wait for it, like its evidence.
      if (marks[log.protocol] === undefined) return;
      const declared = (marks[log.protocol]![log.abi] ?? []).find(
        (item) => item.type === "event" && signature(item) === log.event,
      );
      expect(declared).toBeDefined();
      // `strict` refuses a log whose topics and data do not split exactly as the declaration says:
      // the failure an `indexed` flag the contract does not have produces.
      const decoded = decodeEventLog({
        abi: [declared as unknown as AbiEvent],
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        data: log.data,
        strict: true,
      });
      expect(decoded.eventName).toBe(declared!.name);
    },
  );
});

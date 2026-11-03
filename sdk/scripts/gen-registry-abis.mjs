#!/usr/bin/env node
// Writes every registry ABI — each protocol's `abis.ts` export and its `<Export>.json` twin — as the
// FULL ABI of the deployed contract it speaks for, from the captured evidence
// (`test/fixtures/registry-abi/evidence.json`, see `capture-registry-abi.mjs`):
//
//   - every function, event and custom error the verified ABIs of the export's deployments declare
//     (the implementation behind a proxy, every facet of a diamond or selector router), their union
//     where the deployments run different releases. A function no deployment dispatches is left
//     out: nothing could call it. A chain's deployment that does not run one of the union's
//     functions is the evidence's to say, and `gen-source-globals.mjs` withholds it on that chain;
//   - for a contract with no verified source, the functions of its reference interface
//     (`reference/index.json`) the deployed code dispatches, each recorded under `unverified`;
//   - for an ERC standard (`standard` in its target: an interface whose deployments are examples),
//     its reference interface alone, where every example dispatches each function;
//   - of the events and errors, only those some deployment's code carries (`events`/`errors` in the
//     evidence): one no code carries is left out, and a shipped one a deployment does not carry is
//     listed against it under `uncarried` in `omitted.json`. An anonymous event stays anonymous.
//   - a deployment whose verified ABI is carried from a capture that kept only the registry's
//     names (`carried.partial`) is listed under `partial` in `omitted.json`: its ABI may lack more.
//
// What the registry declares already is kept exactly as written, comments included, so every
// program that compiles keeps compiling. What cannot be exposed is left out and listed, with why,
// in `test/fixtures/registry-abi/omitted.json`, which the registry's generated documents render:
//   - overloads: a name's overloads are told apart by their argument count, and are all reads or
//     all writes (`descriptors-linkage.test.ts`). Of two that take as many arguments, the registry's
//     is kept, else the one a target's `overloads` names, else the one most deployments dispatch
//     (then the shorter signature, then the first in order);
//   - names the SDK reads as its own (an accessor's properties, a value's methods) and, on a
//     protocol's default contract, the name of a sibling contract (`<Protocol>.<name>` is it);
//   - a function or event whose deployments declare it differently, where no chain can be told
//     apart to withhold it from (an interface's examples, an event).
// A registry function that would be left out for its name fails the run instead.
//
//   node scripts/gen-registry-abis.mjs            # write
//   node scripts/gen-registry-abis.mjs --check    # exit 1 when a written file is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import ts from "typescript";
import { toEventSelector, toFunctionSelector } from "viem";

import { createTsLoader } from "./lib/load-ts.mjs";
import {
  ACCESSOR_PROPERTIES,
  defaultContract,
  pascal,
  protocolContracts,
} from "./lib/registry-contracts.mjs";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(sdk, "test", "fixtures", "registry-abi");
const OMITTED = join(FIXTURES, "omitted.json");
const CHECK = process.argv.includes("--check");
const load = createTsLoader(sdk);

function fail(message) {
  throw new Error(`gen-registry-abis: ${message}`);
}

/**
 * Names a method cannot have: an accessor's properties (`descriptors/accessors.ts`) and a value's
 * own methods, which a call on any result is (`routes/contract-results.ts` VALUE_METHODS, of which
 * `toBytesBe`/`toBytesLe` are also the scalar methods `protocol-rewrite.ts` reads an address with).
 */
const RESERVED = new Map([
  ...[...ACCESSOR_PROPERTIES].map((name) => [name, "an accessor's own property"]),
  ...["catch", "concat", "slice", "toBe", "toBytesBe", "toBytesLe", "toLe"].map((name) => [
    name,
    "a method every value has",
  ]),
]);

const { CANONICAL_CHAINS } = load("src/chains/canonical.ts");
const { listProtocols } = load("src/protocols/index.ts");
const targets = JSON.parse(readFileSync(join(FIXTURES, "targets.json"), "utf8")).protocols;
const evidence = JSON.parse(readFileSync(join(FIXTURES, "evidence.json"), "utf8"));
const reference = readReference();
const evmChainIds = new Set(CANONICAL_CHAINS.filter((c) => c.kind === "evm").map((c) => c.id));

/** `<slug>.<Export>` -> the reference interfaces' items. */
function readReference() {
  const dir = join(FIXTURES, "reference");
  const out = new Map();
  if (!existsSync(join(dir, "index.json"))) return out;
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  for (const [key, files] of Object.entries(index.exports)) {
    out.set(
      key,
      files.flatMap(({ file }) => JSON.parse(readFileSync(join(dir, file), "utf8"))),
    );
  }
  return out;
}

// --- the comparisons registry-abi.test.ts makes ---------------------------------------------------

const canonical = (p) =>
  p.type.startsWith("tuple")
    ? `(${(p.components ?? []).map(canonical).join(",")})${p.type.slice("tuple".length)}`
    : p.type;
const signature = (f) => `${f.name}(${(f.inputs ?? []).map(canonical).join(",")})`;
const outputTypes = (outputs) => `(${(outputs ?? []).map(canonical).join(",")})`;
const normalize = (name) => (name ?? "").replace(/^_+|_+$/g, "").toLowerCase();
const fieldNames = (params) =>
  params
    .map((p) =>
      p.components
        ? `{${p.components.map((c) => normalize(c.name) + fieldNames([c])).join(",")}}`
        : "",
    )
    .join(",");
const mutability = (m) => (m === "pure" ? "view" : (m ?? "nonpayable"));
const isRead = (f) => mutability(f.stateMutability) === "view";
/** What the test holds a function's declaration to: two that agree here are the same function. */
const functionKey = (f) =>
  JSON.stringify([
    signature(f),
    outputTypes(f.outputs),
    mutability(f.stateMutability),
    fieldNames(f.inputs ?? []),
  ]);
const indexing = (inputs) =>
  inputs.map((p) => `${p.indexed ? "indexed " : ""}${canonical(p)}`).join(", ");
/** An event's or error's: its types, an event's `indexed` flags, and whether it is anonymous. */
const markKey = (m) =>
  JSON.stringify([
    m.type,
    signature(m),
    m.type === "event" ? indexing(m.inputs) : "",
    m.type === "event" && m.anonymous === true,
  ]);
const markId = (m) =>
  m.type === "event" ? toEventSelector(signature(m)) : toFunctionSelector(signature(m));
const exceptionKey = (item) =>
  item.type === "function" ? signature(item) : `${item.type} ${signature(item)}`;

// --- ABI items as the registry writes them ---------------------------------------------------------

const param = (p, top, event) => ({
  name: p.name ?? "",
  type: p.type,
  ...(p.components ? { components: p.components.map((c) => param(c, false, false)) } : {}),
  ...(top && event ? { indexed: Boolean(p.indexed) } : {}),
});
/** A verified fragment or a reference item, as an `abis.ts` entry. */
function abiItem(f, type = f.type ?? "function") {
  const name = f.name ?? f.signature.slice(0, f.signature.indexOf("("));
  if (type === "function") {
    return {
      name,
      type,
      stateMutability:
        f.stateMutability ?? (f.constant ? "view" : f.payable ? "payable" : "nonpayable"),
      inputs: (f.inputs ?? []).map((p) => param(p, true, false)),
      outputs: (f.outputs ?? []).map((p) => param(p, true, false)),
    };
  }
  return {
    name,
    type,
    // An anonymous event's log carries no topic0: its topics are its indexed parameters alone.
    ...(type === "event" && f.anonymous === true ? { anonymous: true } : {}),
    inputs: (f.inputs ?? []).map((p) => param(p, true, type === "event")),
  };
}

// --- one export --------------------------------------------------------------------------------------

/**
 * The full ABI of `slug`'s `exportName`, and what was left out of it: `{ items, omitted }`. `today`
 * is the export as `abis.ts` writes it; `contracts` the protocol's.
 */
function fullAbi(slug, exportName, today, target, contracts) {
  if (target.unverifiable !== undefined)
    return { items: today, omitted: [], uncarried: {}, partial: [] };
  const linked = contracts.filter((c) => c.abiExport === exportName);
  for (const key of ["standard", "common"]) {
    if (target[key] !== undefined && linked.some((c) => c.kind !== "interface")) {
      fail(`${slug}.${exportName}: \`${key}\` is for an interface, and a role is bound to it`);
    }
  }
  const standard = target.standard !== undefined;
  const common = target.common !== undefined;
  if (standard && common) fail(`${slug}.${exportName}: \`standard\` and \`common\` both`);
  const rows = evidence.instances.filter(
    (r) => r.protocol === slug && r.abi === exportName && r.error === undefined,
  );
  if (rows.length === 0) fail(`${slug}.${exportName}: no captured deployment — recapture ${slug}`);
  const verifiedOf = (row) => (row.verified ?? []).map((id) => evidence.fragments[id]);
  const ref = reference.get(`${slug}.${exportName}`) ?? [];
  if (standard && ref.length === 0) fail(`${slug}.${exportName}: a standard needs its reference`);
  const dispatchers = (selector) => rows.filter((r) => (r.selectors?.[selector] ?? null) !== null);
  /** A standard's and a `common` interface's functions are those every deployment runs. */
  const everyRow = standard || common;
  const omitted = [];
  const omit = (item, reason) => omitted.push({ signature: exceptionKey(item), reason });

  // Functions: the registry's as written, then the union's.
  const todayFns = today.filter((i) => i.type === "function");
  const todayBySelector = new Map(todayFns.map((f) => [toFunctionSelector(signature(f)), f]));
  /** selector -> [declaration, rows declaring it][] */
  const declared = new Map();
  if (!standard) {
    for (const row of rows) {
      for (const frag of verifiedOf(row)) {
        if (frag.type !== undefined) continue;
        const byJson = declared.get(frag.selector) ?? new Map();
        const json = JSON.stringify(abiItem(frag));
        byJson.set(json, [...(byJson.get(json) ?? []), row]);
        declared.set(frag.selector, byJson);
      }
    }
  }
  const refFns = ref.filter((i) => i.type === "function");
  const added = [];
  const candidates = new Map();
  for (const f of refFns) candidates.set(toFunctionSelector(signature(f)), abiItem(f));
  for (const [selector, byJson] of declared) {
    // The declaration most deployments make; the first in order between equals.
    const best = [...byJson].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )[0];
    candidates.set(selector, JSON.parse(best[0]));
  }
  for (const [selector, item] of [...candidates].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (todayBySelector.has(selector)) continue;
    const by = dispatchers(selector);
    if (everyRow ? by.length < rows.length : by.length === 0) {
      omit(
        item,
        everyRow
          ? `not every ${standard ? "example " : ""}deployment dispatches it`
          : "no captured deployment dispatches it",
      );
      continue;
    }
    if (common) {
      const lacking = rows.filter(
        (row) => !verifiedOf(row).some((f) => f.type === undefined && f.selector === selector),
      );
      if (lacking.length > 0) {
        omit(
          item,
          `not every deployment declares it (${lacking.map((r) => `${r.chainId}:${r.address}`).join(", ")} does not)`,
        );
        continue;
      }
    }
    // Every deployment's verified declaration must agree where none can be withheld from: a
    // standard's examples and an interface's are all one contract, and so is a role's instance
    // that only represents others (`instances`). A verified ABI that declares the name only with
    // other parameters disagrees too. A role's own deployment that disagrees is withheld on its
    // chain instead.
    const key = functionKey(item);
    const differing = rows.filter((row) => {
      if (row.role !== undefined) return false;
      const fns = verifiedOf(row).filter((f) => f.type === undefined);
      const frag = fns.find((f) => f.selector === selector);
      if (frag === undefined) return fns.some((f) => f.signature.startsWith(`${item.name}(`));
      return functionKey(abiItem(frag)) !== key;
    });
    if (differing.length > 0) {
      omit(
        item,
        `its deployments declare it differently (${differing.map((r) => `${r.chainId}:${r.address}`).join(", ")} ` +
          `do not declare ${signature(item)} returning ${outputTypes(item.outputs)} as ${mutability(item.stateMutability)})`,
      );
      continue;
    }
    added.push({ item, dispatched: by.length });
  }

  // Names.
  const contract = defaultContract(contracts);
  const siblings =
    contract?.abiExport === exportName ? new Set(contracts.map((c) => c.contract)) : new Set();
  const named = (item) =>
    RESERVED.get(item.name) ??
    (siblings.has(item.name)
      ? `a contract of ${pascal(slug)} is named so: \`${pascal(slug)}.${item.name}\` is that contract`
      : undefined);
  for (const f of todayFns) {
    const why = named(f);
    if (why !== undefined)
      fail(`${slug}.${exportName}: the registry's ${signature(f)} is named as ${why}`);
  }
  const kept = [];
  for (const entry of added) {
    const why = named(entry.item);
    if (why === undefined) kept.push(entry);
    else omit(entry.item, `its name is ${why}`);
  }

  // Overloads: one per argument count, all reads or all writes.
  const preferred = new Set(Object.keys(target.overloads ?? {}));
  const byName = new Map();
  for (const f of todayFns) {
    byName.set(f.name, [
      ...(byName.get(f.name) ?? []),
      { item: f, today: true, dispatched: Infinity },
    ]);
  }
  for (const entry of kept) {
    byName.set(entry.item.name, [...(byName.get(entry.item.name) ?? []), entry]);
  }
  const rank = (a, b) =>
    Number(Boolean(b.today)) - Number(Boolean(a.today)) ||
    Number(preferred.has(signature(b.item))) - Number(preferred.has(signature(a.item))) ||
    b.dispatched - a.dispatched ||
    signature(a.item).length - signature(b.item).length ||
    signature(a.item).localeCompare(signature(b.item));
  const functions = [];
  for (const [name, entries] of byName) {
    const byArity = new Map();
    for (const e of entries) {
      const n = e.item.inputs.length;
      byArity.set(n, [...(byArity.get(n) ?? []), e]);
    }
    let survivors = [];
    for (const group of byArity.values()) {
      if (group.filter((e) => e.today).length > 1) {
        fail(`${slug}.${exportName}: the registry declares two ${name} overloads of one arity`);
      }
      const [keep, ...rest] = [...group].sort(rank);
      survivors.push(keep);
      for (const e of rest) {
        omit(
          e.item,
          `an overload of ${signature(keep.item)}, which takes as many arguments: a call picks ` +
            "its overload by argument count",
        );
      }
    }
    const reads = survivors.filter((e) => isRead(e.item));
    const writes = survivors.filter((e) => !isRead(e.item));
    if (reads.length > 0 && writes.length > 0) {
      const score = (list) => [
        list.some((e) => e.today) ? 1 : 0,
        list.some((e) => preferred.has(signature(e.item))) ? 1 : 0,
        list.length,
        list.reduce((n, e) => n + (e.today ? 0 : e.dispatched), 0),
      ];
      const [r, w] = [score(reads), score(writes)];
      const readsWin =
        r.findIndex((v, i) => v !== w[i]) === -1 ||
        r.find((v, i) => v !== w[i]) > w[r.findIndex((v, i) => v !== w[i])];
      const [win, lose] = readsWin ? [reads, writes] : [writes, reads];
      if (lose.some((e) => e.today)) {
        fail(`${slug}.${exportName}: the registry's ${name} overloads mix reads and writes`);
      }
      for (const e of lose) {
        omit(
          e.item,
          `${readsWin ? "a write" : "a read"} where ${win.map((x) => signature(x.item)).join(", ")} ` +
            `${readsWin ? "reads" : "writes"}: a name's overloads are all reads or all writes, ` +
            "since a call is bound as one before its overload is picked",
        );
      }
      survivors = win;
    }
    functions.push(...survivors.map((e) => e.item));
  }
  for (const sig of preferred) {
    if (!functions.some((f) => signature(f) === sig)) {
      fail(`${slug}.${exportName}: \`overloads\` keeps ${sig}, which is not among its functions`);
    }
  }

  // Events and errors: the registry's as written, then the union's, each only where some
  // deployment's code carries it (an event's topic before its LOG, an error's selector before its
  // REVERT, an anonymous event the LOG its indexed parameters take): a contract whose code carries
  // none never logs or reverts with it. A shipped one a deployment's code does not carry is recorded
  // against that deployment (`uncarried`), as a function a chain's deployment lacks is withheld.
  const at = (row) => `${row.chainId}:${row.address}`;
  const locatedOn = (row, m) => (m.type === "event" ? row.events : row.errors)?.[markId(m)];
  const carriers = (m) => {
    const missing = rows.filter((row) => locatedOn(row, m) === undefined);
    if (missing.length > 0) {
      fail(
        `${slug}.${exportName}: ${exceptionKey(m)} was not located on ${missing.map(at).join(", ")} — recapture ${slug}`,
      );
    }
    return rows.filter((row) => locatedOn(row, m) !== null);
  };
  const NOT_CARRIED =
    "no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library";
  const shippedMarks = [];
  for (const written of today.filter((i) => i.type === "event" || i.type === "error")) {
    // An event its verified declarations make anonymous is written so, the rest as it was.
    let m = written;
    if (m.type === "event" && m.anonymous !== true) {
      const declared = rows
        .flatMap(verifiedOf)
        .filter((f) => f.type === "event" && f.signature === signature(m));
      const anonymous = declared.filter((f) => f.anonymous === true).length;
      if (anonymous > 0 && anonymous < declared.length) {
        fail(`${slug}.${exportName}: the deployments declare ${signature(m)} anonymous and not`);
      }
      if (anonymous > 0) m = { name: m.name, type: m.type, anonymous: true, inputs: m.inputs };
    }
    if (carriers(m).length === 0) omit(m, NOT_CARRIED);
    else shippedMarks.push(m);
  }
  const todayMarkIds = new Set(
    today
      .filter((i) => i.type === "event" || i.type === "error")
      .map((m) => `${m.type} ${markId(m)}`),
  );
  const marks = new Map();
  const markSources = standard
    ? [ref.filter((i) => i.type === "event" || i.type === "error").map((m) => abiItem(m, m.type))]
    : rows.map((row) =>
        verifiedOf(row)
          .filter((f) => f.type !== undefined)
          .map((f) => abiItem(f, f.type)),
      );
  for (const list of markSources) {
    for (const m of list) {
      const id = `${m.type} ${markId(m)}`;
      if (todayMarkIds.has(id)) continue;
      const entry = marks.get(id) ?? new Map();
      const json = JSON.stringify(m);
      entry.set(json, (entry.get(json) ?? 0) + 1);
      marks.set(id, entry);
    }
  }
  for (const [, byJson] of [...marks].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ranked = [...byJson].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const best = JSON.parse(ranked[0][0]);
    if (carriers(best).length === 0) {
      omit(best, NOT_CARRIED);
      continue;
    }
    const keys = new Set(ranked.map(([json]) => markKey(JSON.parse(json))));
    if (keys.size > 1) {
      omit(
        best,
        "its deployments declare it with different indexed parameters, or anonymous in one",
      );
      continue;
    }
    if (common && ranked.reduce((n, [, count]) => n + count, 0) < rows.length) {
      omit(best, "not every deployment declares it");
      continue;
    }
    shippedMarks.push(best);
  }
  /** `<chainId>:<address>` -> the shipped events and errors that deployment's code does not carry. */
  const uncarried = {};
  for (const m of shippedMarks) {
    for (const row of rows) {
      if (locatedOn(row, m) === null) (uncarried[at(row)] ??= []).push(exceptionKey(m));
    }
  }
  for (const list of Object.values(uncarried)) list.sort();

  // Deployments whose verified ABI could not be fetched, carried from a capture that kept only
  // what the registry declared then: this ABI may lack what they run.
  const partial = [];
  for (const row of rows) {
    for (const source of row.abiSources ?? []) {
      if (source.carried === undefined) continue;
      if (typeof source.carried !== "object" || typeof source.carried.partial !== "boolean") {
        fail(
          `${slug}.${exportName}: ${at(row)} carries ${source.address} unflagged — recapture ${slug}`,
        );
      }
      if (source.carried.partial) {
        partial.push({ deployment: at(row), source: source.address, date: source.carried.date });
      }
    }
  }

  const byOrder = (a, b) =>
    a.name.localeCompare(b.name) ||
    (a.inputs?.length ?? 0) - (b.inputs?.length ?? 0) ||
    signature(a).localeCompare(signature(b));
  const items = [
    ...functions.sort(byOrder),
    ...shippedMarks.filter((m) => m.type === "event").sort(byOrder),
    ...shippedMarks.filter((m) => m.type === "error").sort(byOrder),
  ];
  omitted.sort((a, b) => a.signature.localeCompare(b.signature));
  return { items, omitted, uncarried, partial };
}

// --- abis.ts, rewritten in place --------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const literal = (value) =>
  Array.isArray(value)
    ? `[${value.map(literal).join(", ")}]`
    : value !== null && typeof value === "object"
      ? `{ ${Object.entries(value)
          .map(([k, v]) => `${IDENTIFIER.test(k) ? k : JSON.stringify(k)}: ${literal(v)}`)
          .join(", ")} }`
      : JSON.stringify(value);

/** `abis.ts` with each export's array replaced, the comments over a kept entry carried with it. */
function rewrite(path, text, abis, full) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(file);
      const init = declaration.initializer;
      if (!full.has(name) || init === undefined) continue;
      const array = ts.isAsExpression(init) ? init.expression : init;
      if (!ts.isArrayLiteralExpression(array)) fail(`${path}: ${name} is not an array literal`);
      const comments = new Map();
      array.elements.forEach((element, index) => {
        // The comments before an entry and anywhere inside it: they stay with the entry, above it.
        const ranges = new Map();
        const collect = (node) => {
          for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(r.pos, r);
          ts.forEachChild(node, collect);
        };
        collect(element);
        if (ranges.size === 0) return;
        const item = abis[name][index];
        comments.set(
          item.type === "function" ? signature(item) : `${item.type} ${signature(item)}`,
          [...ranges.values()]
            .sort((a, b) => a.pos - b.pos)
            .map((r) => text.slice(r.pos, r.end))
            .join("\n"),
        );
      });
      const trailing = ts.getLeadingCommentRanges(text, array.elements.end) ?? [];
      if (trailing.length > 0) fail(`${path}: ${name} has a comment after its last entry`);
      const body = full
        .get(name)
        .map((item) => {
          const comment = comments.get(exceptionKey(item));
          return `${comment === undefined ? "" : `${comment}\n`}${literal(item)},`;
        })
        .join("\n");
      edits.push([init.getStart(file), init.end, `[\n${body}\n] as const`]);
    }
  }
  let out = text;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

// --- run -------------------------------------------------------------------------------------------

const writes = [];
const omittedByExport = {};
const uncarriedByExport = {};
const partialByExport = {};
for (const info of [...listProtocols()].sort((a, b) => a.slug.localeCompare(b.slug))) {
  const slug = info.slug;
  const dir = join(sdk, "src", "protocols", slug);
  const abisPath = join(dir, "abis.ts");
  if (!existsSync(abisPath)) continue;
  const abis = load(`src/protocols/${slug}/abis.ts`);
  const { deployments } = load(`src/protocols/${slug}/addresses.ts`);
  const spec = targets[slug] ?? {};
  const contracts = protocolContracts({ slug, info, deployments, spec, evmChainIds, fail });
  const full = new Map();
  for (const [name, today] of Object.entries(abis)) {
    if (!Array.isArray(today)) continue;
    if (spec[name] === undefined) fail(`${slug}.${name} has no binding in targets.json`);
    const { items, omitted, uncarried, partial } = fullAbi(
      slug,
      name,
      today,
      spec[name],
      contracts,
    );
    full.set(name, items);
    if (omitted.length > 0) omittedByExport[`${slug}.${name}`] = omitted;
    if (Object.keys(uncarried).length > 0) uncarriedByExport[`${slug}.${name}`] = uncarried;
    if (partial.length > 0) partialByExport[`${slug}.${name}`] = partial;
    writes.push([
      join(dir, `${name}.json`),
      `${JSON.stringify({ abi: items }, null, 2)}\n`,
      "json",
    ]);
  }
  const text = readFileSync(abisPath, "utf8");
  writes.push([abisPath, rewrite(abisPath, text, abis, full), "typescript"]);
}
writes.push([
  OMITTED,
  `${JSON.stringify(
    {
      note:
        "Generated by sdk/scripts/gen-registry-abis.mjs from evidence.json, targets.json and reference/: " +
        "exports: each function, event and error of an export's deployments that its registry ABI does " +
        "not declare, and why. uncarried: per deployment, the events and errors the ABI declares that " +
        "the deployment's code does not carry. partial: the deployments whose verified ABI could not " +
        "be fetched and is carried from a capture that kept only what the registry then declared, so " +
        "the ABI may lack what they run. Do not edit by hand.",
      exports: omittedByExport,
      uncarried: uncarriedByExport,
      partial: partialByExport,
    },
    null,
    2,
  )}\n`,
  "json",
]);

const options = await prettier.resolveConfig(join(sdk, "src", "protocols", "erc20", "abis.ts"));
const stale = [];
for (const [path, text, parser] of writes) {
  const formatted = await prettier.format(text, { ...options, parser });
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (current === formatted) continue;
  if (CHECK) stale.push(path);
  else writeFileSync(path, formatted);
}
if (CHECK && stale.length > 0) {
  process.stderr.write(
    `${stale.map((p) => p.slice(sdk.length + 1)).join("\n")}\nstale; run pnpm --filter './sdk' gen-registry-abis\n`,
  );
  process.exitCode = 1;
} else if (!CHECK) {
  process.stdout.write(`wrote ${writes.length} files\n`);
}

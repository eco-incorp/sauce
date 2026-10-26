/**
 * Action programs as JSON: strict parsing with located errors, and canonical serialization.
 *
 * A program is plain data — `{ version, chainId, actions }` — so it can be written by hand, stored,
 * signed, sent to another service, or produced in any language against the published JSON Schema
 * (`action-program.schema.json`). `parseProgram` accepts exactly what that schema accepts and then
 * applies the rules a schema cannot express (`semantics.ts`); every problem is reported with its
 * path, not just the first.
 *
 * Round trip: for any program `p` this module accepts, `parseProgram(serializeProgram(p))`
 * deep-equals `p`. Parsing only reorders keys; it fills in no defaults.
 */
import { getAddress } from "viem";

import {
  ACTION_SPECS,
  ACTION_TYPES,
  POT,
  RETIRED_POT,
  type ActionSpec,
  type FieldDef,
  type FieldKind,
  type Fields,
} from "./spec.js";
import {
  CONTRACT_NAME_RE,
  isTokenSymbol,
  NATIVE,
  registrySpelling,
  TOKEN_SYMBOL_RE,
} from "./names.js";
import {
  balancerBatchIssues,
  IDENTIFIER_RE,
  ProgramError,
  programIssues,
  type ProgramIssue,
} from "./semantics.js";
import type { Action, ActionProgram, ActionType } from "./types.js";

/** The action-program format version this package reads and writes. */
export const PROGRAM_VERSION = 1;

const UINT_RE = /^(0|[1-9][0-9]*)$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

const PROGRAM_KEYS = ["$schema", "version", "chainId", "actions"] as const;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string")
    return JSON.stringify(value.length > 48 ? `${value.slice(0, 45)}...` : value);
  if (typeof value === "object") return "an object";

  return `${typeof value} ${String(value)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A key that is present. An `undefined` value — which JSON cannot carry — counts as absent. */
function has(value: Record<string, unknown>, key: string): boolean {
  return key in value && value[key] !== undefined;
}

/** The closest of `candidates` to `word`, when it is close enough to be a likely typo. */
function suggest(word: string, candidates: readonly string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const next = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = next;
      }
    }

    return row[b.length]!;
  };
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return bestDistance <= Math.max(2, Math.floor(word.length / 4)) ? best : undefined;
}

class Checker {
  readonly issues: ProgramIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** Checks `value` against `kind`; returns false (having recorded why) when it does not match. */
  value(path: string, value: unknown, kind: FieldKind): boolean {
    const start = this.issues.length;
    switch (kind.k) {
      case "address":
        this.address(path, value);
        break;
      case "token":
      case "contract":
      case "tokenContract":
        this.named(path, value, kind);
        break;
      case "recipient":
        if (value === RETIRED_POT)
          this.fail(path, `the Pot is "${POT}", not "${RETIRED_POT}": write "${POT}"`);
        else if (value !== POT) this.address(path, value, ` or "${POT}"`);
        break;
      case "remoteRecipient":
        if (typeof value === "string" && BYTES32_RE.test(value)) break;
        this.address(path, value, " or a 32-byte account (0x + 64 hex digits)");
        break;
      case "uint":
        if (typeof value === "bigint") {
          this.fail(
            path,
            `expected a base-10 string, got the bigint ${value} — JSON has no bigint: write "${value}"`,
          );
        } else if (typeof value === "number") {
          this.fail(
            path,
            `expected a base-10 string, got the JSON number ${value} — JSON numbers lose precision ` +
              `above 2^53, so amounts are strings: write ${JSON.stringify(Number.isInteger(value) && value >= 0 ? BigInt(value).toString() : "123")}`,
          );
        } else if (typeof value !== "string" || !UINT_RE.test(value)) {
          this.fail(
            path,
            `expected a base-10 unsigned integer string (digits only, no sign, exponent or leading zeros), got ${describe(value)}`,
          );
        } else if (BigInt(value) >= 1n << BigInt(kind.bits)) {
          this.fail(path, `${value} does not fit in ${kind.bits} bits`);
        }
        break;
      case "bytes":
        if (typeof value !== "string" || !BYTES_RE.test(value))
          this.fail(
            path,
            `expected 0x-prefixed hex bytes (an even number of hex digits), got ${describe(value)}`,
          );
        break;
      case "bytes32":
        if (typeof value !== "string" || !BYTES32_RE.test(value))
          this.fail(path, `expected 32 bytes: 0x + 64 hex digits, got ${describe(value)}`);
        break;
      case "int":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          this.fail(path, `expected a JSON integer, got ${describe(value)}`);
        } else if (value < kind.min || value > kind.max) {
          this.fail(path, `${value} is outside ${kind.min}..${kind.max}`);
        }
        break;
      case "enum":
        if (!kind.values.includes(value as string | number))
          this.fail(
            path,
            `expected one of ${kind.values.map((v) => JSON.stringify(v)).join(", ")}, got ${describe(value)}`,
          );
        break;
      case "bool":
        if (typeof value !== "boolean")
          this.fail(path, `expected true or false, got ${describe(value)}`);
        break;
      case "identifier":
        if (typeof value !== "string" || !IDENTIFIER_RE.test(value))
          this.fail(
            path,
            `expected an identifier ([A-Za-z_$][A-Za-z0-9_$]*), got ${describe(value)}`,
          );
        break;
      case "array":
        if (!Array.isArray(value)) {
          this.fail(path, `expected an array, got ${describe(value)}`);
          break;
        }
        if (kind.min !== undefined && value.length < kind.min)
          this.fail(
            path,
            `expected at least ${kind.min} ${kind.min === 1 ? "entry" : "entries"}, got ${value.length}`,
          );
        if (kind.max !== undefined && value.length > kind.max)
          this.fail(path, `expected at most ${kind.max} entries, got ${value.length}`);
        value.forEach((item, i) => this.value(`${path}[${i}]`, item, kind.of));
        break;
      case "tuple":
        if (!Array.isArray(value) || value.length !== kind.of.length) {
          this.fail(
            path,
            `expected an array of exactly ${kind.of.length} entries, got ${describe(value)}${Array.isArray(value) ? ` of ${value.length}` : ""}`,
          );
          break;
        }
        value.forEach((item, i) => this.value(`${path}[${i}]`, item, kind.of[i]!));
        break;
      case "object":
        this.object(path, value, kind.fields, []);
        break;
    }

    return this.issues.length === start;
  }

  /**
   * A token or contract field: an address, or a name in the spelling a program uses — a registry
   * token symbol, a `Namespace.Contract` reference, or `"native"` where the field takes it. Only
   * the spelling is checked here; whether the name exists is the compiled chain's question.
   */
  private named(
    path: string,
    value: unknown,
    kind: Extract<FieldKind, { k: "token" | "contract" | "tokenContract" }>,
  ): void {
    const symbols = kind.k !== "contract";
    const contracts = kind.k !== "token";
    const native = kind.k === "token" && kind.native === true;
    const expected = [
      symbols ? 'a registry token symbol ("USDC")' : undefined,
      contracts ? 'a protocol contract ("UniswapV3.Factory")' : undefined,
      native ? '"native"' : undefined,
      "an address (0x + 40 hex digits)",
    ].filter((part) => part !== undefined);
    const wanted = `expected ${expected.slice(0, -1).join(", ")} or ${expected.at(-1)}`;
    if (typeof value === "string" && /^0x/i.test(value)) {
      this.address(path, value);
      return;
    }
    if (typeof value !== "string") {
      this.fail(path, `${wanted}, got ${describe(value)}`);
      return;
    }
    if (value === NATIVE) {
      if (!native) {
        this.fail(
          path,
          `"native" is not a token this field takes — only a venue that trades the native ` +
            `currency itself takes it (uniswapV4Swap, ambientSwap, balancerV2BatchSwap); ${wanted}`,
        );
      }
      return;
    }
    if (isTokenSymbol(value)) {
      if (!symbols) {
        this.fail(
          path,
          `${JSON.stringify(value)} is a token symbol, and this field is a protocol contract: ` +
            `name it as "Namespace.Contract" ("UniswapV3.Factory"), or give its address`,
        );
      }
      return;
    }
    if (CONTRACT_NAME_RE.test(value)) {
      if (!contracts) {
        this.fail(
          path,
          `${JSON.stringify(value)} is a protocol contract, and this field is a token: give its ` +
            'registry symbol ("USDC") or its address',
        );
      }
      return;
    }
    const upper = value.toUpperCase();
    // A stock's symbol is its issuer's ticker, not upper case: `spcxc` is `SPCXc`.
    const spelled = symbols ? registrySpelling(value) : undefined;
    const hint =
      native && (upper === "ETH" || upper === "NATIVE")
        ? ' — the native currency is "native"'
        : spelled !== undefined && spelled !== upper
          ? ` — a stock token's symbol is its issuer's ticker: did you mean ${JSON.stringify(spelled)}?`
          : symbols && TOKEN_SYMBOL_RE.test(upper)
            ? ` — symbols are upper case: did you mean ${JSON.stringify(upper)}?`
            : "";
    this.fail(path, `${wanted}, got ${describe(value)}${hint}`);
  }

  private address(path: string, value: unknown, alternative = ""): void {
    if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
      this.fail(
        path,
        `expected an address (0x + 40 hex digits)${alternative}, got ${describe(value)}`,
      );
      return;
    }
    const hex = value.slice(2);
    const mixedCase = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
    if (mixedCase && getAddress(value) !== value) {
      this.fail(
        path,
        `${value} has an invalid EIP-55 checksum (expected ${getAddress(value)}); write it all-lowercase to skip the check`,
      );
    }
  }

  /** Checks an object's fields; `extra` names keys handled by the caller. */
  object(
    path: string,
    value: unknown,
    fields: Fields,
    extra: readonly string[],
  ): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
      this.fail(path, `expected an object, got ${describe(value)}`);
      return false;
    }
    const known = [...Object.keys(fields), ...extra];
    for (const key of Object.keys(value)) {
      if (!known.includes(key) && has(value, key)) {
        const hint = suggest(key, known);
        this.fail(
          `${path}.${key}`,
          `unknown field${hint ? ` — did you mean \`${hint}\`?` : ""} (allowed: ${known.join(", ")})`,
        );
      }
    }
    for (const [key, def] of Object.entries(fields) as [string, FieldDef][]) {
      if (!has(value, key)) {
        if (!def.optional) this.fail(`${path}.${key}`, `missing (${def.doc})`);
        continue;
      }
      this.value(`${path}.${key}`, value[key], def.kind);
    }

    return true;
  }
}

/** The keys an action of `spec` may carry, in canonical (serialization) order. */
export function actionKeys(spec: ActionSpec): string[] {
  return [
    "type",
    ...(spec.spends ? ["amount"] : []),
    ...Object.keys(spec.fields),
    ...(spec.spends ? ["amountRef"] : []),
    "saveOutputAs",
  ];
}

function checkAction(c: Checker, path: string, value: unknown): Action | undefined {
  if (!isPlainObject(value)) {
    c.fail(path, `expected an action object, got ${describe(value)}`);
    return undefined;
  }
  const type = value.type;
  if (typeof type !== "string" || !(type in ACTION_SPECS)) {
    const hint = typeof type === "string" ? suggest(type, ACTION_TYPES) : undefined;
    c.fail(
      `${path}.type`,
      type === undefined
        ? "missing — every action names its `type`"
        : `unknown action type ${describe(type)}${hint ? ` — did you mean "${hint}"?` : ""}`,
    );
    return undefined;
  }
  const spec = ACTION_SPECS[type as ActionType];
  const extra = ["type", "saveOutputAs"];
  if (spec.spends) {
    extra.push("amount", "amountRef");
  } else {
    // Reported here, once, with the reason — not also as an unknown field.
    for (const key of ["amount", "amountRef"]) {
      if (!has(value, key)) continue;
      c.fail(
        `${path}.${key}`,
        spec.group === "source"
          ? `${type} spends nothing, so it takes no \`${key}\``
          : `${type} takes its amounts from its own fields, so it takes no \`${key}\``,
      );
      extra.push(key);
    }
  }
  const before = c.issues.length;
  if (!c.object(path, value, spec.fields, extra)) return undefined;
  alternatives(c, path, value, spec);

  if (spec.spends && has(value, "amount"))
    c.value(`${path}.amount`, value.amount, { k: "uint", bits: 256 });
  for (const key of ["saveOutputAs", "amountRef"] as const) {
    if (has(value, key) && (key === "saveOutputAs" || spec.spends))
      c.value(`${path}.${key}`, value[key], { k: "identifier" });
  }
  if (type === "balancerV2BatchSwap" && Array.isArray(value.steps) && Array.isArray(value.assets)) {
    const assets = value.assets.length;
    (value.steps as unknown[]).forEach((step, i) => {
      if (!isPlainObject(step)) return;
      for (const key of ["assetInIndex", "assetOutIndex"] as const) {
        const index = step[key];
        if (typeof index === "number" && index >= assets) {
          c.fail(
            `${path}.steps[${i}].${key}`,
            `${index} is not an index into \`assets\` (${assets} entries)`,
          );
        }
      }
    });
  }
  if (c.issues.length > before) return undefined;
  c.issues.push(...balancerBatchIssues(value as unknown as Action, path));
  if (c.issues.length > before) return undefined;

  // A deep copy, in canonical key order.
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  return ordered(copy, actionKeys(spec), spec.fields) as unknown as Action;
}

/** `fields` as a person reads them: `pool`, `factory + fee`. */
const spelled = (fields: readonly string[]): string => fields.map((f) => `\`${f}\``).join(" + ");

/**
 * The action's `oneOf` and `together` rules: it carries exactly the fields of one alternative (a
 * pool by its address, or by its key), and fields that go together are given together.
 */
function alternatives(
  c: Checker,
  path: string,
  value: Record<string, unknown>,
  spec: ActionSpec,
): void {
  for (const group of spec.together ?? []) {
    const given = group.filter((key) => has(value, key));
    if (given.length > 0 && given.length < group.length) {
      const missing = group.filter((key) => !has(value, key));
      c.fail(
        `${path}.${missing[0]}`,
        `missing: ${spelled(group)} go together — give ${missing.length === 1 ? "it" : "them"} ` +
          `too, or leave ${spelled(given)} out`,
      );
    }
  }
  const options = spec.oneOf;
  if (options === undefined) return;
  const named = [...new Set(options.flat())];
  const given = named.filter((key) => has(value, key));
  if (options.some((option) => sameSet(option, given))) return;
  const ways = options.map(spelled).join(", or ");
  if (given.length === 0) {
    c.fail(`${path}.${options[0]![0]}`, `missing: give ${ways}`);
    return;
  }
  // The alternative the action came closest to, to name what is extra or missing from it.
  const nearest = [...options].sort(
    (a, b) => distanceTo(a, given) - distanceTo(b, given) || a.length - b.length,
  )[0]!;
  const extra = given.filter((key) => !nearest.includes(key));
  const missing = nearest.filter((key) => !given.includes(key));
  if (extra.length > 0) {
    c.fail(
      `${path}.${extra[0]}`,
      `${spelled(extra)} cannot go with ${spelled(given.filter((key) => !extra.includes(key)))}: ` +
        `give exactly one of ${ways}`,
    );
    return;
  }
  c.fail(`${path}.${missing[0]}`, `missing: with ${spelled(given)}, give ${spelled(missing)} too`);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key) => b.includes(key));

/** How many fields `given` would add or drop to become `option`. */
const distanceTo = (option: readonly string[], given: readonly string[]): number =>
  option.filter((key) => !given.includes(key)).length +
  given.filter((key) => !option.includes(key)).length;

/** `value` rebuilt with its keys in `keys` order (nested objects follow their field order too). */
function ordered(
  value: Record<string, unknown>,
  keys: readonly string[],
  fields: Fields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in value)) continue;
    const def = fields[key];
    out[key] = def ? orderedValue(value[key], def.kind) : value[key];
  }

  return out;
}

function orderedValue(value: unknown, kind: FieldKind): unknown {
  if (kind.k === "object" && isPlainObject(value))
    return ordered(value, Object.keys(kind.fields), kind.fields);
  if (kind.k === "array" && Array.isArray(value))
    return value.map((item) => orderedValue(item, kind.of));

  return value;
}

/**
 * Checks each of `values` as an action on its own — shape and batch value rules, no chaining —
 * and returns canonical copies. Throws a `ProgramError` whose paths start at `path`.
 */
export function parseActions(values: readonly unknown[], path: string): Action[] {
  const c = new Checker();
  const actions = values.flatMap((value, i) => checkAction(c, `${path}[${i}]`, value) ?? []);
  if (c.issues.length > 0) throw new ProgramError(c.issues);

  return actions;
}

type Checked = { readonly program: ActionProgram } | { readonly issues: readonly ProgramIssue[] };

function check(input: unknown): Checked {
  const c = new Checker();
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { issues: [{ path: "$", message: `not valid JSON: ${(error as Error).message}` }] };
    }
  }

  if (!isPlainObject(value)) {
    c.fail("$", `expected an action program object ({ version, actions }), got ${describe(value)}`);
    return { issues: c.issues };
  }
  for (const key of Object.keys(value)) {
    if (!(PROGRAM_KEYS as readonly string[]).includes(key) && has(value, key)) {
      const hint = suggest(key, PROGRAM_KEYS);
      c.fail(
        key,
        `unknown field${hint ? ` — did you mean \`${hint}\`?` : ""} (allowed: ${PROGRAM_KEYS.join(", ")})`,
      );
    }
  }
  if (has(value, "$schema") && typeof value.$schema !== "string")
    c.fail("$schema", `expected a string, got ${describe(value.$schema)}`);
  if (value.version !== PROGRAM_VERSION) {
    c.fail(
      "version",
      value.version === undefined
        ? `missing — set it to ${PROGRAM_VERSION}`
        : `unsupported version ${describe(value.version)}; this package reads version ${PROGRAM_VERSION}`,
    );
  }
  // Optional: a document that names its tokens and contracts is for any chain that has them.
  if (has(value, "chainId"))
    c.value("chainId", value.chainId, { k: "int", min: 1, max: Number.MAX_SAFE_INTEGER });

  const actions: Action[] = [];
  if (!Array.isArray(value.actions)) {
    c.fail(
      "actions",
      value.actions === undefined
        ? "missing"
        : `expected an array of actions, got ${describe(value.actions)}`,
    );
  } else if (value.actions.length === 0) {
    c.fail("actions", "is empty — a program needs at least one action");
  } else {
    value.actions.forEach((raw, i) => {
      const action = checkAction(c, `actions[${i}]`, raw);
      if (action) actions.push(action);
    });
  }

  // The chaining rules read every action, so they run only once every action is well formed.
  const chainId = has(value, "chainId") ? (value.chainId as number) : undefined;
  if (c.issues.length === 0) c.issues.push(...programIssues(actions, chainId));
  if (c.issues.length > 0) return { issues: c.issues };

  return {
    program:
      chainId === undefined
        ? { version: PROGRAM_VERSION, actions }
        : { version: PROGRAM_VERSION, chainId, actions },
  };
}

/**
 * Parses and validates an action program — JSON text, or an already-parsed value. Returns a fresh
 * copy with its keys in canonical order. Throws a `ProgramError` whose `issues` lists every
 * problem, each with its path.
 */
export function parseProgram(input: unknown): ActionProgram {
  const result = check(input);
  if ("issues" in result) throw new ProgramError(result.issues);

  return result.program;
}

/**
 * The canonical JSON text of `program`: validated first, keys in schema order, so two equal
 * programs serialize to the same text. `space` indents as `JSON.stringify` does.
 */
export function serializeProgram(program: ActionProgram, space?: number | string): string {
  return JSON.stringify(parseProgram(program), null, space);
}

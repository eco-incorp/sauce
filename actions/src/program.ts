/**
 * Action programs as JSON: strict parsing with located errors, and canonical serialization.
 *
 * A program is plain data — `{ version, chainId, actions }` — so it can be written by hand, stored,
 * signed, sent to another service, or produced by a client in any language against the published
 * JSON Schema (`action-program.schema.json`). `parseActionProgram` accepts exactly what that schema
 * accepts and then applies the rules a schema cannot express (see `semantics.ts`); every problem is
 * reported with its path, not just the first.
 *
 * Round trip: for any program `p` this module accepts, `parseActionProgram(serializeActionProgram(p))`
 * deep-equals `p`. Parsing fills each action's own chain field from the program's `chainId` when it
 * is omitted, which is the only normalization.
 */
import { getAddress } from "viem";

import {
  ACTION_SPECS,
  ACTION_TYPES,
  type ActionSpec,
  type FieldDef,
  type FieldKind,
  type Fields,
} from "./spec.js";
import {
  ActionProgramError,
  IDENTIFIER_RE,
  actionsSemanticIssues,
  type ActionIssue,
} from "./semantics.js";
import type { ActionProgram, RoutingAction, RoutingActionType } from "./types.js";

/** The only action-program format version. */
export const ACTION_PROGRAM_VERSION = 1;

export type ActionProgramValidation =
  | { readonly ok: true; readonly program: ActionProgram }
  | { readonly ok: false; readonly issues: readonly ActionIssue[] };

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
  readonly issues: ActionIssue[] = [];

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
      case "recipient":
        if (value !== "self") this.address(path, value, ' or "self"');
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
    spec.chainField,
    ...(spec.amountField ? [spec.amountField] : []),
    ...Object.keys(spec.fields),
    ...(spec.chainable ? ["amountRef"] : []),
    "saveOutputAs",
  ];
}

function checkAction(
  c: Checker,
  path: string,
  value: unknown,
  chainId: unknown,
): RoutingAction | undefined {
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
  const spec = ACTION_SPECS[type as RoutingActionType];
  const extra = ["type", spec.chainField, "saveOutputAs"];
  if (spec.amountField) extra.push(spec.amountField);
  if (spec.chainable) extra.push("amountRef");
  if (!spec.chainable && has(value, "amountRef")) {
    c.fail(
      `${path}.amountRef`,
      spec.group === "source"
        ? `${type} consumes no amount, so it takes no \`amountRef\``
        : `${type} cannot take a referenced amount`,
    );
    // Reported once; not also as an unknown field.
    extra.push("amountRef");
  }
  const before = c.issues.length;
  if (!c.object(path, value, spec.fields, extra)) return undefined;

  if (has(value, spec.chainField))
    c.value(`${path}.${spec.chainField}`, value[spec.chainField], {
      k: "int",
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
  if (spec.amountField && has(value, spec.amountField))
    c.value(`${path}.${spec.amountField}`, value[spec.amountField], { k: "uint", bits: 256 });
  for (const key of ["saveOutputAs", "amountRef"] as const) {
    if (has(value, key) && (key !== "amountRef" || spec.chainable))
      c.value(`${path}.${key}`, value[key], { k: "identifier" });
  }
  if (spec.exactlyOne) {
    const [a, b] = spec.exactlyOne;
    const count = Number(has(value, a)) + Number(has(value, b));
    if (count !== 1)
      c.fail(
        path,
        `set exactly one of \`${a}\` and \`${b}\` (got ${count === 0 ? "neither" : "both"})`,
      );
  }
  if (type === "balancerV2BatchSwap" && Array.isArray(value.steps) && Array.isArray(value.assets)) {
    (value.steps as unknown[]).forEach((step, i) => {
      if (!isPlainObject(step)) return;
      for (const key of ["assetInIndex", "assetOutIndex"] as const) {
        const index = step[key];
        if (typeof index === "number" && index >= (value.assets as unknown[]).length) {
          c.fail(
            `${path}.steps[${i}].${key}`,
            `${index} is not an index into \`assets\` (${(value.assets as unknown[]).length} entries)`,
          );
        }
      }
    });
  }
  if (c.issues.length > before) return undefined;

  // A deep copy, in canonical key order, with the chain filled from the program when omitted.
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  if (!has(copy, spec.chainField)) copy[spec.chainField] = chainId;

  return ordered(copy, actionKeys(spec), spec.fields) as unknown as RoutingAction;
}

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
 * Validates `input` — a parsed JSON value, or JSON text — as an action program, without throwing.
 * On success the program is a fresh copy in canonical key order.
 */
export function validateActionProgram(input: unknown): ActionProgramValidation {
  const c = new Checker();
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return {
        ok: false,
        issues: [{ path: "$", message: `not valid JSON: ${(error as Error).message}` }],
      };
    }
  }

  if (!isPlainObject(value)) {
    c.fail(
      "$",
      `expected an action program object ({ version, chainId, actions }), got ${describe(value)}`,
    );
    return { ok: false, issues: c.issues };
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
  if (value.version !== ACTION_PROGRAM_VERSION) {
    c.fail(
      "version",
      value.version === undefined
        ? `missing — set it to ${ACTION_PROGRAM_VERSION}`
        : `unsupported version ${describe(value.version)}; this package reads version ${ACTION_PROGRAM_VERSION}`,
    );
  }
  const chainOk = has(value, "chainId")
    ? c.value("chainId", value.chainId, { k: "int", min: 1, max: Number.MAX_SAFE_INTEGER })
    : (c.fail("chainId", "missing — the chain every action executes on"), false);

  const actions: RoutingAction[] = [];
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
      const action = checkAction(c, `actions[${i}]`, raw, value.chainId);
      if (action) actions.push(action);
    });
  }

  // The chaining rules read every action, so they run only once every action is well formed.
  if (c.issues.length === 0 && chainOk) {
    c.issues.push(...actionsSemanticIssues(actions, value.chainId as number));
  }
  if (c.issues.length > 0) return { ok: false, issues: c.issues };

  return {
    ok: true,
    program: { version: ACTION_PROGRAM_VERSION, chainId: value.chainId as number, actions },
  };
}

/**
 * Parses and validates an action program — a parsed JSON value or JSON text. Throws an
 * `ActionProgramError` whose `issues` lists every problem, each with its path.
 */
export function parseActionProgram(input: unknown): ActionProgram {
  const result = validateActionProgram(input);
  if (!result.ok) throw new ActionProgramError(result.issues);

  return result.program;
}

/**
 * The canonical JSON text of `program`: validated first, keys in schema order, so two equal
 * programs serialize to the same bytes. `space` indents as `JSON.stringify` does.
 */
export function serializeActionProgram(program: ActionProgram, space?: number | string): string {
  const parsed = parseActionProgram(program);

  return JSON.stringify(parsed, null, space);
}

/**
 * An action list as a program on `chainId` — the bridge from the typed `RoutingAction[]` API to the
 * JSON form. Validates it.
 */
export function toActionProgram(actions: readonly RoutingAction[], chainId: number): ActionProgram {
  return parseActionProgram({ version: ACTION_PROGRAM_VERSION, chainId, actions });
}

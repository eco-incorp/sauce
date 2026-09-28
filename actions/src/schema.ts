/**
 * The action-program JSON Schema (draft 2020-12), generated from the same table the parser reads
 * (`spec.ts`), for clients that are not written in TypeScript.
 *
 * The schema is exact about shape and deliberately silent about three things it cannot express,
 * which `parseProgram` enforces and the schema's `description` states: an address's EIP-55
 * checksum, an amount's numeric range beyond its digit count, and the chaining rules across actions
 * (`semantics.ts`). A document the schema rejects is always rejected by the parser; the reverse
 * holds only for those three.
 *
 * `actions/action-program.schema.json` is this function's output, committed so it can be read and
 * fetched without running anything; a unit test fails when the two drift.
 */
import {
  ACTION_SPECS,
  ACTION_TYPES,
  type ActionSpec,
  type FieldDef,
  type FieldKind,
  type Fields,
} from "./spec.js";
import { actionKeys, PROGRAM_VERSION } from "./program.js";

export type JsonSchema = { readonly [key: string]: unknown };

/** Decimal digits of the largest `bits`-bit unsigned integer. */
function maxDigits(bits: number): number {
  return ((1n << BigInt(bits)) - 1n).toString().length;
}

const DEFS = {
  address: {
    type: "string",
    pattern: "^0x[0-9a-fA-F]{40}$",
    description:
      "An address: 0x + 40 hex digits. A mixed-case address must carry a valid EIP-55 checksum.",
  },
  recipient: {
    description: 'An address, or "self" for the executing Pot.',
    oneOf: [{ $ref: "#/$defs/address" }, { const: "self" }],
  },
  remoteRecipient: {
    description: "An address, or a 32-byte account on a non-EVM destination (0x + 64 hex digits).",
    oneOf: [{ $ref: "#/$defs/address" }, { $ref: "#/$defs/bytes32" }],
  },
  bytes: {
    type: "string",
    pattern: "^0x(?:[0-9a-fA-F]{2})*$",
    description: "0x-prefixed hex bytes, an even number of digits.",
  },
  bytes32: {
    type: "string",
    pattern: "^0x[0-9a-fA-F]{64}$",
    description: "32 bytes: 0x + 64 hex digits.",
  },
  identifier: {
    type: "string",
    pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$",
    description: "A name that becomes a local variable in the emitted SauceScript.",
  },
  chainId: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
} as const;

function kindSchema(kind: FieldKind): JsonSchema {
  switch (kind.k) {
    case "address":
    case "recipient":
    case "remoteRecipient":
    case "bytes":
    case "bytes32":
    case "identifier":
      return { $ref: `#/$defs/${kind.k}` };
    case "uint":
      return {
        type: "string",
        pattern: "^(0|[1-9][0-9]*)$",
        maxLength: maxDigits(kind.bits),
        description: `A base-10 unsigned integer of at most ${kind.bits} bits.`,
      };
    case "int":
      return { type: "integer", minimum: kind.min, maximum: kind.max };
    case "enum":
      return { enum: [...kind.values] };
    case "bool":
      return { type: "boolean" };
    case "array":
      return {
        type: "array",
        items: kindSchema(kind.of),
        ...(kind.min !== undefined ? { minItems: kind.min } : {}),
        ...(kind.max !== undefined ? { maxItems: kind.max } : {}),
      };
    case "tuple":
      return {
        type: "array",
        prefixItems: kind.of.map(kindSchema),
        items: false,
        minItems: kind.of.length,
      };
    case "object":
      return objectSchema(kind.fields, {});
  }
}

function field(def: FieldDef): JsonSchema {
  return { ...kindSchema(def.kind), description: def.doc };
}

function objectSchema(fields: Fields, extra: Record<string, JsonSchema>): JsonSchema {
  const properties: Record<string, JsonSchema> = { ...extra };
  for (const [key, def] of Object.entries(fields)) properties[key] = field(def);
  const required = Object.entries(fields)
    .filter(([, def]) => !def.optional)
    .map(([key]) => key);

  return { type: "object", additionalProperties: false, required, properties };
}

function actionSchema(spec: ActionSpec): JsonSchema {
  const extra: Record<string, JsonSchema> = { type: { const: spec.type } };
  if (spec.spends) {
    extra.amount = {
      ...kindSchema({ k: "uint", bits: 256 }),
      description:
        "The amount this action spends. Omit it (and amountRef) to spend the previous action's output.",
    };
    extra.amountRef = {
      $ref: "#/$defs/identifier",
      description: "Spend the output an earlier action saved under this name.",
    };
  }
  extra.saveOutputAs = {
    $ref: "#/$defs/identifier",
    description: "Save this action's output under a name later actions can reference.",
  };

  const schema = objectSchema(spec.fields, extra);
  const properties = schema.properties as Record<string, JsonSchema>;
  // Properties in canonical order, which is the order `serializeProgram` writes.
  const orderedProperties = Object.fromEntries(
    actionKeys(spec)
      .filter((key) => key in properties)
      .map((key) => [key, properties[key]!]),
  );

  return {
    title: spec.type,
    description: `${spec.summary} Calls ${spec.calls}.`,
    ...schema,
    required: ["type", ...(schema.required as string[])],
    properties: orderedProperties,
  };
}

/** The JSON Schema every action program satisfies. */
export function programSchema(): JsonSchema {
  const actionDefs = Object.fromEntries(
    ACTION_TYPES.map((type) => [`action_${type}`, actionSchema(ACTION_SPECS[type])]),
  );

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:eco-incorp:sauce:action-program:${PROGRAM_VERSION}`,
    title: "Sauce action program",
    description:
      "A sequence of protocol actions that compiles to one Sauce program executing on one chain. " +
      "Amounts are base-10 strings. Beyond this schema, a program must satisfy: every address with " +
      "mixed-case hex carries a valid EIP-55 checksum; every amount fits its declared width; a " +
      "first action that takes an amount sets `amount`; an amountRef names a " +
      "saveOutputAs set by an earlier action, and is not combined with `amount`; argument names " +
      "are unique; and the value of every balanceOf/nativeBalance/argument action is read.",
    type: "object",
    additionalProperties: false,
    required: ["version", "chainId", "actions"],
    properties: {
      $schema: { type: "string", description: "The schema this document declares; ignored." },
      version: { const: PROGRAM_VERSION },
      chainId: { $ref: "#/$defs/chainId", description: "The chain every action executes on." },
      actions: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/$defs/action" },
        description: "The actions, in execution order.",
      },
    },
    $defs: {
      ...DEFS,
      action: { oneOf: ACTION_TYPES.map((type) => ({ $ref: `#/$defs/action_${type}` })) },
      ...actionDefs,
    },
  };
}

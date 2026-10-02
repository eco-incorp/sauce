/**
 * The action-program JSON Schema (draft 2020-12), generated from the same table the parser reads
 * (`spec.ts`), for clients that are not written in TypeScript.
 *
 * The schema is exact about shape and deliberately silent about four things it cannot express,
 * which `parseProgram` and the compile enforce and the schema's `description` states: an address's
 * EIP-55 checksum, an amount's numeric range beyond its digit count, the chaining rules across
 * actions (`semantics.ts`), and whether a token symbol or a namespace reference exists on the chain
 * a program is compiled for (`names.ts`). A document the schema rejects is always rejected by the
 * parser; the reverse holds only for those four.
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
import { CONTRACT_NAME_RE, NATIVE, STOCK_SYMBOL_RE } from "./names.js";
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
  tokenSymbol: {
    type: "string",
    pattern: STOCK_SYMBOL_RE.source,
    description:
      'A registry token symbol, as a Sauce program writes it: "USDC", "WETH", or a tokenized ' +
      'stock\'s, which is its issuer\'s ticker ("SPCXc", "TSLAon", "bTSLA"). It resolves on the ' +
      "chain the program is compiled for; a chain that does not register it refuses the program, " +
      "naming the chain and the symbol. `sauce globals --chain <chain> --tokens` lists them, and " +
      "`--stocks` the chain's stock tokens.",
  },
  contractName: {
    type: "string",
    pattern: CONTRACT_NAME_RE.source,
    description:
      'A protocol contract by namespace, as a Sauce program writes it: "UniswapV3.Factory", ' +
      '"BalancerV2.Vault", "UniswapV4.PoolManager". It resolves on the chain the program is ' +
      "compiled for; a chain without it refuses the program. `sauce globals --chain <chain> " +
      "--protocols` lists them.",
  },
  token: {
    description: "A token: a registry symbol, or an address.",
    oneOf: [{ $ref: "#/$defs/tokenSymbol" }, { $ref: "#/$defs/address" }],
  },
  tokenOrNative: {
    description:
      'A token: a registry symbol, an address, or "native" for the native currency, which the ' +
      "venue keys as the zero address.",
    oneOf: [{ $ref: "#/$defs/tokenSymbol" }, { $ref: "#/$defs/address" }, { const: NATIVE }],
  },
  contract: {
    description: "A protocol contract: a namespace reference, or an address.",
    oneOf: [{ $ref: "#/$defs/contractName" }, { $ref: "#/$defs/address" }],
  },
  tokenContract: {
    description:
      "A contract that is also a token (WETH, wstETH): a registry symbol, a namespace reference, " +
      "or an address.",
    oneOf: [
      { $ref: "#/$defs/tokenSymbol" },
      { $ref: "#/$defs/contractName" },
      { $ref: "#/$defs/address" },
    ],
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
    case "contract":
    case "tokenContract":
      return { $ref: `#/$defs/${kind.k}` };
    case "token":
      return { $ref: kind.native === true ? "#/$defs/tokenOrNative" : "#/$defs/token" };
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
    description: `${spec.summary} Calls ${spec.calls}.${alternativesText(spec)}`,
    ...schema,
    required: ["type", ...(schema.required as string[])],
    properties: orderedProperties,
    ...alternativesSchema(spec),
  };
}

const spelled = (fields: readonly string[]): string => fields.join(" + ");

/** The action's `oneOf` and `together` rules, said in its description. */
function alternativesText(spec: ActionSpec): string {
  const parts: string[] = [];
  if (spec.oneOf !== undefined) {
    parts.push(` Give exactly one of: ${spec.oneOf.map(spelled).join("; ")}.`);
  }
  for (const group of spec.together ?? [])
    parts.push(` Give ${spelled(group)} together or not at all.`);

  return parts.join("");
}

/**
 * `oneOf`: each alternative requires its own fields and forbids the other alternatives' — so a pool
 * is named by its address or by one key, never by both. `together`: `dependentRequired` both ways.
 */
function alternativesSchema(spec: ActionSpec): JsonSchema {
  const out: Record<string, unknown> = {};
  if (spec.oneOf !== undefined) {
    const named = [...new Set(spec.oneOf.flat())];
    // Each alternative's own fields are `true` here (their schema is the action's), every other
    // alternative's `false`: present, it fails the alternative.
    out.oneOf = spec.oneOf.map((option) => ({
      required: [...option],
      properties: Object.fromEntries(named.map((key) => [key, option.includes(key)])),
    }));
  }
  if (spec.together !== undefined) {
    out.dependentRequired = Object.fromEntries(
      spec.together.flatMap((group) =>
        group.map((key) => [key, group.filter((other) => other !== key)]),
      ),
    );
  }

  return out;
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
      'Amounts are base-10 strings. A token is a registry symbol ("USDC", or a tokenized ' +
      "stock's, its issuer's ticker: \"SPCXc\") or an address, and a " +
      'protocol contract a namespace reference ("UniswapV3.Factory") or an address; a name ' +
      "resolves on the chain the program is compiled for, so a document with no chainId compiles " +
      "for any chain where its names exist. Beyond this schema, a program must satisfy: every " +
      "address with mixed-case hex carries a valid EIP-55 checksum; every amount fits its declared " +
      "width; a first action that takes an amount sets `amount`; an amountRef names a " +
      "saveOutputAs set by an earlier action, and is not combined with `amount`; argument names " +
      "are unique; the value of every balanceOf/nativeBalance/argument action is read; and every " +
      "token symbol and namespace reference exists on the chain it is compiled for.",
    type: "object",
    additionalProperties: false,
    required: ["version", "actions"],
    properties: {
      $schema: { type: "string", description: "The schema this document declares; ignored." },
      version: { const: PROGRAM_VERSION },
      chainId: {
        $ref: "#/$defs/chainId",
        description:
          "The chain the document is written for; compiling it for another is refused. Leave it " +
          "out of a document that names its tokens and contracts: it then compiles for any chain " +
          "where those names exist, the chain chosen when it is compiled.",
      },
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

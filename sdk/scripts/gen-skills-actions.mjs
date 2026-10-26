#!/usr/bin/env node
// The `sauce-actions` agent skill's reference: every action type an actions document may hold,
// with every field — `skills/sauce-actions/references/actions.md` at the repository root.
//
// ONE SOURCE. Everything here is read from the actions JSON Schema the package ships
// (`actions/action-program.schema.json`, which `actions/scripts/gen-schema.ts` writes from the same
// field table the parser reads). This only lays the schema out for reading: each action's
// description, the ways it may name its pool, and each field's value kind, whether it is required,
// and what it means. Nothing is added that the schema does not say.
//
// It reads a committed file, so it runs in the SDK's `build` beside `gen-skills-references.mjs`, which
// rewrites the reference; the reference is committed, CI rebuilds and fails when that changed it, and
// the skills checker (`check-skills.mjs`) compares it with `renderActionsReference()` the same way.
//
//   node scripts/gen-skills-actions.mjs           write the reference
//   node scripts/gen-skills-actions.mjs --check   exit 1 when it is stale
//   import { renderActionsReference }             the file's text, for the skills checker
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The schema, where the repository and the published package both keep it. */
export const SCHEMA_PATH = join(SDK, "..", "actions", "action-program.schema.json");
/** Where the reference goes, beside the `sauce-actions` skill that links it. */
export const ACTIONS_REFERENCE = join(
  SDK,
  "..",
  "skills",
  "sauce-actions",
  "references",
  "actions.md",
);

const HEADER =
  "<!-- Generated from the actions JSON Schema the package ships: every action `sauce actions` takes. Do not edit. -->";

/** The `$defs` a `$ref` names. */
const defOf = (ref) => ref.replace("#/$defs/", "");

/** A value's kind, as the reference's "Value" column spells it. */
function kindOf(schema, defs) {
  if (schema.$ref !== undefined) {
    const name = defOf(schema.$ref);
    return (
      {
        token: "token",
        tokenOrNative: 'token or `"native"`',
        contract: "contract",
        tokenContract: "token or contract",
        address: "address",
        recipient: 'address or `"pot"`',
        remoteRecipient: "address or 32-byte account",
        bytes: "hex bytes",
        bytes32: "32 bytes",
        identifier: "name",
        chainId: "chain id, an integer ≥ 1",
      }[name] ??
      defs[name]?.description ??
      name
    );
  }
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum !== undefined)
    return schema.enum.map((v) => `\`${JSON.stringify(v)}\``).join(" or ");
  if (schema.type === "boolean") return "true or false";
  if (schema.type === "integer") {
    const max = schema.maximum >= Number.MAX_SAFE_INTEGER ? "" : `${schema.maximum}`;
    return max === "" ? `integer ≥ ${schema.minimum}` : `integer ${schema.minimum}–${max}`;
  }
  if (schema.type === "string" && schema.pattern === "^(0|[1-9][0-9]*)$") {
    // The digit count bounds the width: 78 digits is a uint256, 49 a uint160, 39 a uint128.
    const bits = { 78: 256, 49: 160, 39: 128 }[schema.maxLength];
    return bits === undefined ? "base-10 integer string" : `base-10 integer string, uint${bits}`;
  }
  if (schema.type === "array") {
    const bounds =
      schema.prefixItems !== undefined
        ? ""
        : [
            schema.minItems === undefined ? undefined : `at least ${schema.minItems}`,
            schema.maxItems === undefined ? undefined : `at most ${schema.maxItems}`,
          ]
            .filter((b) => b !== undefined)
            .join(", ");
    if (schema.prefixItems !== undefined) {
      return `[${schema.prefixItems.map((item) => kindOf(item, defs)).join(", ")}]`;
    }
    const of = schema.items.type === "object" ? "objects (below)" : kindOf(schema.items, defs);
    return `array of ${of}${bounds === "" ? "" : ` (${bounds})`}`;
  }

  return schema.type ?? "value";
}

const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The fields of one object schema, as a table; `alternatives` marks the fields a pool form names. */
function fieldTable(schema, defs, alternatives = []) {
  const named = new Set(alternatives.flat());
  const rows = Object.entries(schema.properties).map(([key, property]) => {
    const required = schema.required.includes(key)
      ? "yes"
      : named.has(key)
        ? "one form (above)"
        : "no";
    const meaning = property.description ?? (key === "type" ? "the action" : "");

    return `| \`${key}\` | ${cell(kindOf(property, defs))} | ${required} | ${cell(meaning)} |`;
  });

  return ["| Field | Value | Required | Meaning |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

/** Every object-valued array field's own fields, under the action's table. */
function nestedTables(schema, defs) {
  return Object.entries(schema.properties)
    .filter(([, property]) => property.type === "array" && property.items?.type === "object")
    .map(([key, property]) => `Each \`${key}\` entry:\n\n${fieldTable(property.items, defs)}`);
}

/** The reference's text, from the schema. */
export function renderActionsReference(schema) {
  const defs = schema.$defs;
  const types = defs.action.oneOf.map((entry) => defs[defOf(entry.$ref)]);
  const first = (text) => text.split(/(?<=\.)\s/)[0];
  const anchor = (title) => title.toLowerCase();
  const kinds = [
    ["token", "token"],
    ['token or `"native"`', "tokenOrNative"],
    ["contract", "contract"],
    ["token or contract", "tokenContract"],
    ["address", "address"],
    ['address or `"pot"`', "recipient"],
    ["address or 32-byte account", "remoteRecipient"],
    ["hex bytes", "bytes"],
    ["32 bytes", "bytes32"],
    ["name", "identifier"],
  ];
  const sections = types.map((action) => {
    const alternatives = action.oneOf?.map((option) => option.required) ?? [];
    const forms =
      alternatives.length === 0
        ? []
        : [
            `It names its pool one of ${alternatives.length} ways: ${alternatives
              .map((option) => option.map((key) => `\`${key}\``).join(" + "))
              .join(", or ")}.`,
          ];
    const together = Object.entries(action.dependentRequired ?? {})
      .filter(([key, others]) => others.every((other) => key < other))
      .map(
        ([key, others]) =>
          `Give ${[key, ...others].map((k) => `\`${k}\``).join(" and ")} together or not at all.`,
      );

    return [
      `### ${action.title}`,
      "",
      action.description,
      ...(forms.length + together.length === 0 ? [] : ["", ...forms, ...together]),
      "",
      fieldTable(action, defs, alternatives),
      ...nestedTables(action, defs).flatMap((table) => ["", table]),
    ].join("\n");
  });

  return [
    HEADER,
    "",
    "# Every action",
    "",
    schema.description,
    "",
    "## The document",
    "",
    fieldTable(schema, defs),
    "",
    "## Values",
    "",
    "| Value | Takes |",
    "| --- | --- |",
    ...kinds.map(([label, def]) => `| ${label} | ${cell(defs[def].description)} |`),
    "| base-10 integer string | Digits only: no sign, exponent or leading zeros. `uint<N>` is the width it must fit. |",
    "",
    "## The actions",
    "",
    "| Action | Does |",
    "| --- | --- |",
    ...types.map(
      (action) =>
        `| [\`${action.title}\`](#${anchor(action.title)}) | ${cell(first(action.description))} |`,
    ),
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n");
}

/** The reference as the schema at `schemaPath` renders it, and whether the file on disk differs. */
export function freshActionsReference(schemaPath = SCHEMA_PATH, path = ACTIONS_REFERENCE) {
  const text = renderActionsReference(JSON.parse(readFileSync(schemaPath, "utf8")));

  return { path, text, stale: !existsSync(path) || readFileSync(path, "utf8") !== text };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const file = freshActionsReference();
  if (process.argv.includes("--check")) {
    if (file.stale) {
      console.error(
        `gen-skills-actions: stale ${relative(process.cwd(), file.path)} — rebuild the SDK, or run ` +
          "`node scripts/gen-skills-actions.mjs`, and commit the result.",
      );
      process.exit(1);
    }
  } else {
    if (file.stale) writeFileSync(file.path, file.text);
    console.log(
      `gen-skills-actions: ${relative(process.cwd(), file.path)} (${file.stale ? "rewritten" : "unchanged"})`,
    );
  }
}

#!/usr/bin/env node
// SauceScript's builtins, declared for TypeScript route closures, generated from the reference's
// own data: `docs/api/builtins.json`. A closure passed to `Base(() => { ... })` is compiled source,
// but the host type-checks it first, so `ctx`, `crypto.keccak256`, `hex` and the rest need
// declarations. They install nothing at run time.
//
//   node sdk/scripts/gen-builtins.mjs [--check | --stdout]
//
// Each builtin's `signature` is read as `<receiver>.<name>(<params>): <type>`, `<name>(<params>):
// <type>`, or `<receiver>.<name>: <type>` for a property. A builtin whose signature is none of
// those is syntax TypeScript already has (`throw`, `==`, `-x`), or a contract binding, which
// takes its methods from the ABI it binds and is typed by `source-globals.generated.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(sdk, "../docs/api/builtins.json");
const output = resolve(sdk, "src/routes/builtins.generated.ts");
const { builtins } = JSON.parse(readFileSync(input, "utf8"));

/** Splits `a: X, b: Y<P, Q>` on its top-level commas. */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("<[({".includes(ch)) depth++;
    if (">])}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** A SauceScript type, as the TypeScript type a closure writes or reads in its place. */
function tsType(type, position) {
  type = type.trim();
  if (type.endsWith("[]")) {
    const element = tsType(type.slice(0, -2), position);
    return position === "param" ? `readonly (${element})[]` : `${element}[]`;
  }
  if (type.startsWith("[")) {
    return `[${splitTop(type.slice(1, -1))
      .map((t) => tsType(t, position))
      .join(", ")}]`;
  }
  if (/^Account(<.*>)?$/.test(type)) return "SauceAccount";
  switch (type) {
    case "Uint256":
    case "Address":
    case "number":
    case "bigint":
      return "bigint";
    case "bool":
      return "boolean";
    case "bytes":
      return position === "param" ? "SauceBytesLike" : "SauceBytes";
    case "scalar":
      return "SauceScalar";
    case "value":
      return "unknown";
    case "string":
      return "string";
    case "void":
      return "void";
    default:
      throw new Error(`gen-builtins: no TypeScript type for SauceScript type '${type}'`);
  }
}

/** `name: T`, `name?: T`, `...name: T[]` as a TypeScript parameter. */
function tsParam(param) {
  const match = /^(\.\.\.)?(\w+)(\?)?: (.+)$/.exec(param);
  if (match === null) throw new Error(`gen-builtins: unreadable parameter '${param}'`);
  const [, rest, name, optional, type] = match;
  if (rest) return `...${name}: ${tsType(type.replace(/\[\]$/, ""), "param")}[]`;
  return `${name}${optional ?? ""}: ${tsType(type, "param")}`;
}

const targetsOf = ({ targets }) =>
  targets.length === 2 ? "EVM and SVM" : `${targets[0].toUpperCase()} only`;
const doc = (builtin, indent) =>
  `${indent}/** \`${builtin.signature}\` — ${targetsOf(builtin)}. */\n`;

/** Members by where they are declared. */
const members = new Map();
const add = (where, text) => members.set(where, [...(members.get(where) ?? []), text]);
const declared = [];

for (const builtin of builtins) {
  const { signature } = builtin;
  const method = /^([A-Za-z]+)\.(\w+)\((.*)\): (.+)$/.exec(signature);
  const fn = /^(\w+)\((.*)\): (.+)$/.exec(signature);
  const property = /^(account|\(bytes \| T\[\]\))\.(\w+): (.+)$/.exec(signature);
  const construct = /^new (\w+)\((.*)\): (.+)$/.exec(signature);
  const tagged = /^(\w+)`[^`]*`: (.+)$/.exec(signature);

  if (method !== null) {
    const [, receiver, name, params, returns] = method;
    // `abi.decode`'s result is shaped by its shape strings, so it is typed from them.
    const text =
      receiver === "abi" && name === "decode"
        ? `${doc(builtin, "  ")}  decode<const Shape extends readonly string[]>(data: SauceBytesLike, shape: Shape): { -readonly [K in keyof Shape]: SauceDecoded<Shape[K]> };`
        : `${doc(builtin, "  ")}  ${name}(${splitTop(params).map(tsParam).join(", ")}): ${tsType(returns, "return")};`;
    add(receiver, text);
  } else if (fn !== null) {
    const [, name, params, returns] = fn;
    add("function", { builtin, name, params: splitTop(params).map(tsParam), returns });
  } else if (property !== null) {
    const [, receiver, name, type] = property;
    add(
      receiver === "account" ? "account" : "bytes",
      `${doc(builtin, "  ")}  readonly ${name}: ${tsType(type, "return")};`,
    );
  } else if (construct !== null) {
    const [, name, params, returns] = construct;
    add(
      `new ${name}`,
      `${doc(builtin, "  ")}  new (${splitTop(params).map(tsParam).join(", ")}): ${tsType(returns, "return")};`,
    );
  } else if (tagged !== null) {
    const [, name, returns] = tagged;
    declared.push(
      `${doc(builtin, "  ")}  function ${name}(strings: TemplateStringsArray): ${tsType(returns, "return")};`,
    );
  }
}

const known = new Set([
  "ctx",
  "crypto",
  "Math",
  "abi",
  "evm",
  "svm",
  "bytes",
  "value",
  "account",
  "function",
  "new Array",
]);
for (const where of members.keys()) {
  if (!known.has(where)) throw new Error(`gen-builtins: no declaration for receiver '${where}'`);
}
const block = (where) => (members.get(where) ?? []).join("\n");

/** A builtin function, with `require` and `eval` merged into the host's names of the same. */
const functions = (members.get("function") ?? []).map(({ builtin, name, params, returns }) => {
  const signature = `(${params.join(", ")}): ${tsType(returns, "return")}`;
  if (name === "require") {
    return `${doc(builtin, "    ")}    ${signature};`;
  }
  return `${doc(builtin, "  ")}  function ${name}${signature};`;
});
const requireSignature = functions.filter((f) => !f.includes("  function "));
const globalFunctions = functions.filter((f) => f.includes("  function "));

const generated = `// GENERATED by sdk/scripts/gen-builtins.mjs from docs/api/builtins.json — do not edit.
// SauceScript's builtins, for TypeScript route closures. No runtime objects are installed: a closure
// is compiled source, never invoked. The Sauce compiler checks the language subset and each
// builtin's target; these declarations give a typed closure the names and call shapes, and say in
// each comment which targets have it. See docs/api/saucescript.md.
/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-empty-object-type -- a
   builtin that shares a host name merges into the host's declaration of it, which takes the
   host's forms: Node types \`require\` in its \`NodeJS\` namespace and \`crypto\` in \`webcrypto\`,
   and an interface that only extends \`SauceCrypto\` is how \`crypto\`'s builtins join each. */
import type { SauceBytes } from "./source-globals.generated.js";

/** A bytes argument: a text literal, \`hex\`…\`\`, or a bytes value. */
export type SauceBytesLike = string | SauceBytes;

/** A scalar argument: a number, an address or a bool. */
export type SauceScalar = bigint | number | boolean;

/** A field of \`abi.decode\`'s result, typed from its shape string. */
export type SauceDecoded<Shape> = Shape extends "bool" | "boolean"
  ? boolean
  : Shape extends "bytes" | "string"
    ? SauceBytes
    : Shape extends \`\${string}[]\` | \`{\${string}}\`
      ? unknown
      : bigint;

/** An account the transaction attaches (SVM), or an address (EVM). */
export interface SauceAccount {
${block("account")}
}

/** \`ctx\`: context reads. */
export interface SauceContext {
${block("ctx")}
}

/** \`abi\`: Solidity ABI encoding. */
export interface SauceAbi {
${block("abi")}
}

/** \`evm\`: raw calls and storage on the EVM. */
export interface SauceEvm {
${block("evm")}
}

/** \`svm\`: accounts and cross-program calls on the SVM. */
export interface SauceSvm {
${block("svm")}
}

declare module "./source-globals.generated.js" {
  interface SauceBytes {
${block("bytes").replace(/^ {2}/gm, "    ")}
  }
}

/** \`crypto\`: hashes, signatures and program addresses. */
export interface SauceCrypto {
${block("crypto")}
}

// Node types \`crypto\` as its own \`webcrypto.Crypto\` where no DOM declares one, so the builtins
// merge into that too.
declare module "crypto" {
  namespace webcrypto {
    interface Crypto extends SauceCrypto {}
  }
}

declare global {
  const ctx: SauceContext;
  const abi: SauceAbi;
  const evm: SauceEvm;
  const svm: SauceSvm;

  /** The DOM's \`crypto\`. The host declares the variable: the DOM, a worker or Node. Declaring it
   *  here too would clash with Node's own declaration of it. */
  interface Crypto extends SauceCrypto {}

  /** SauceScript's integer functions, merged into the host's \`Math\`. */
  interface Math {
${block("Math").replace(/^ {2}/gm, "    ")}
  }

  /** Methods on a number. */
  interface BigInt {
${block("value").replace(/^ {2}/gm, "    ")}
  }

  interface ArrayConstructor {
${block("new Array").replace(/^ {2}/gm, "    ")}
  }

${globalFunctions.join("\n")}
${declared.join("\n")}

  namespace NodeJS {
    /** \`require(condition, message?)\`, merged into the host's \`require\`. */
    interface Require {
${requireSignature.map((s) => s.replace(/^ {4}/gm, "      ")).join("\n")}
    }
  }
  var require: NodeJS.Require;
}
`;

if (process.argv.includes("--stdout")) process.stdout.write(generated);
else if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) {
    process.stderr.write(
      "Builtin declarations are stale; run pnpm --filter './sdk' gen-builtins\n",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, generated);
  process.stdout.write(`wrote ${output}\n`);
}

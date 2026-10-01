#!/usr/bin/env node
// Route bodies are compiled source, not JavaScript callbacks. These declarations
// describe their token/protocol names without installing host runtime objects.
// Read literal registry initializers through the TypeScript AST: no build, ABI
// inference, or execution of application modules is needed to regenerate types.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(sdk, "src/routes/source-globals.generated.ts");
const pascal = (slug) =>
  slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

function literal(node) {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))
          throw new Error("Source-global registries must contain literal properties");
        return [property.name.text, literal(property.initializer)];
      }),
    );
  throw new Error(`Non-literal registry expression: ${node.getText()}`);
}

function readConstant(file, name) {
  const path = resolve(sdk, "src", file);
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      )
        return literal(declaration.initializer);
  }
  throw new Error(`Missing ${name} in ${path}`);
}

function valueType(parameter, input) {
  const array = /^(.*)\[\d*\]$/.exec(parameter.type);
  if (array) {
    const element = valueType({ ...parameter, type: array[1] }, input);
    return input ? `(readonly (${element})[] | SauceArray<${element}>)` : `SauceArray<${element}>`;
  }
  if (/^(u?int\d*|address|bytes\d+)$/.test(parameter.type)) return "bigint";
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
      throw new Error("A Sauce tuple needs distinct, named ABI components");
    return `{ ${fields.map((field) => `${JSON.stringify(field.name)}: ${valueType(field, input)}`).join("; ")} }`;
  }
  throw new Error(`Unsupported Sauce ABI type: ${parameter.type}`);
}

function resultType(outputs) {
  if (!outputs.length) return "void";
  if (outputs.length === 1) return valueType(outputs[0], false);
  const tuple = `[${outputs.map((field) => valueType(field, false)).join(", ")}]`;
  const named = outputs.filter((field) => field.name);
  if (new Set(named.map((field) => field.name)).size !== named.length)
    throw new Error("Duplicate ABI output name");
  return named.length
    ? `${tuple} & { ${named.map((field) => `${JSON.stringify(field.name)}: ${valueType(field, false)}`).join("; ")} }`
    : tuple;
}

function methods(link) {
  if (!link.abiExport) return [];
  const abi = readConstant(`protocols/${link.protocol}/abis.ts`, link.abiExport);
  return abi
    .filter((entry) => entry.type === "function")
    .map((method) => {
      const args = method.inputs
        .map((field, index) => `arg${index}: ${valueType(field, true)}`)
        .join(", ");
      return `    ${JSON.stringify(method.name)}(${args}): ${resultType(method.outputs ?? [])};`;
    });
}

const links = readConstant("descriptors/links.ts", "CONTRACT_LINKS");
const tokens = [
  ...new Set(
    Object.values(readConstant("routes/token-registry.ts", "TOKEN_REGISTRY"))
      .flat()
      .map((row) => row.symbol),
  ),
].sort();
// Solana's mints: a symbol only a Solana program has is its mint's key, a value and no more (the
// token methods are EVM-only); one an EVM chain also has keeps the EVM declaration.
const mints = [
  ...new Set(
    Object.values(readConstant("routes/token-registry.ts", "SVM_TOKEN_ENTRIES"))
      .flat()
      .map((row) => row.symbol),
  ),
]
  .filter((symbol) => !tokens.includes(symbol))
  .sort();
const chains = readConstant("chains/canonical.ts", "CANONICAL_CHAINS");
const declarations = [];
const reserved = new Set([
  ...chains.map((chain) => pascal(chain.slug)),
  "Token",
  "chain",
  "chainId",
  "CHAIN_ID",
]);
function declare(name, type) {
  if (!ts.isIdentifierText(name, ts.ScriptTarget.Latest) || reserved.has(name))
    throw new Error(`Source global '${name}' is invalid or collides with another global`);
  reserved.add(name);
  declarations.push(`  const ${name}: ${type};`);
}

const protocols = [...new Set(links.map((link) => link.protocol))];
const definitions = [];
const families = new Map();
for (const protocol of protocols) {
  // The source rewrite refuses both unbound interfaces and address-only entries.
  const entries = links.filter((link) => link.protocol === protocol && link.kind === "singleton");
  if (!entries.length) continue;
  const name = pascal(protocol);
  const fields = entries.map(
    (link) =>
      `  readonly ${JSON.stringify(link.contract)}: bigint & {\n${methods(link).join("\n")}\n  };`,
  );
  if (entries.length === 1) fields.push(...methods(entries[0]));
  definitions.push(`export interface ${name}Source {\n${fields.join("\n")}\n}`);
  declare(name, `${name}Source`);
  const stem = /^(.*)-v\d+$/.exec(protocol)?.[1];
  if (stem) {
    const key = pascal(stem);
    const members = families.get(key) ?? [];
    members.push(...entries.map((link) => ({ ...link, namespace: name })));
    families.set(key, members);
  }
}
for (const [family, entries] of families) {
  const fields = [];
  for (const entry of entries) {
    if (entries.filter((other) => other.contract === entry.contract).length !== 1) continue;
    fields.push(
      `  readonly ${JSON.stringify(entry.contract)}: ${entry.namespace}Source[${JSON.stringify(entry.contract)}];`,
    );
  }
  definitions.push(`export interface ${family}Source {\n${fields.join("\n")}\n}`);
  declare(family, `${family}Source`);
}
for (const token of tokens) declare(token, "bigint & SauceTokenSource");
for (const mint of mints) declare(mint, "bigint");

const generated = `// GENERATED by sdk/scripts/gen-source-globals.mjs — do not edit.
// Source-only names for compiled EVM route bodies. No runtime objects are installed.
// Addresses and availability are resolved for the destination chain at compile time.
// TypeScript checks names and call shapes; the Sauce compiler checks its own language
// subset, target capabilities, ABI fidelity, and per-chain deployment availability.

/**
 * ERC-20 calls in compiled source. Addresses are Sauce scalars. The writes have SafeERC20 semantics
 * and return nothing: each reverts the program unless the token accepted it.
 */
export interface SauceTokenSource {
  transfer(to: bigint, amount: bigint): void;
  approve(spender: bigint, amount: bigint): void;
  transferFrom(from: bigint, to: bigint, amount: bigint): void;
  balanceOf(owner: bigint): bigint;
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

${definitions.join("\n\n")}

declare global {
${declarations.join("\n")}
  /** Destination chain identity supplied by openRoute. */
  const chainId: bigint;
  const CHAIN_ID: bigint;
}
`;
if (process.argv.includes("--stdout")) process.stdout.write(generated);
else if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) {
    process.stderr.write(
      "Source globals are stale; run pnpm --filter './sdk' gen-source-globals\n",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, generated);
  process.stdout.write(`wrote ${output}\n`);
}

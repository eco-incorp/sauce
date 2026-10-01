/**
 * The one parser every route rewrite reads SauceScript with: acorn, extended to TypeScript.
 *
 * SauceScript is a checked subset of TypeScript, and annotations are part of it — an unannotated
 * parameter is a number, so a helper that takes or returns an array, a record or bytes must say so.
 * The rewrites still left (`intent-sugar.ts`, `closure.ts`) run on
 * the source before the compiler does, so they have to parse whatever it accepts. A JavaScript
 * parser refused the first annotation it met.
 *
 * WHY THIS PARSER. `@sveltejs/acorn-typescript` is an acorn plugin: the AST stays ESTree, so every
 * rewrite keeps its walks and its byte ranges, and TypeScript only adds nodes for the types. It has
 * no dependencies of its own (acorn is a peer, already this package's parser), touches no Node API,
 * and is maintained as the TypeScript parser of Svelte. Both it and acorn are pinned exactly: the
 * plugin extends acorn's parser class, so a drifting acorn minor could change what it parses.
 * Browser bundle cost, minified: acorn alone 117 KiB (33 KiB gzipped), with the plugin 227 KiB
 * (61 KiB gzipped) — about 1% of the compiler's own 2.3 MiB of WebAssembly the same page loads.
 *
 * The alternative was a stripper written against the compiler's own type grammar, which would have
 * been smaller and a second grammar to keep in step with the compiler's: every type syntax the
 * compiler learned would first fail in the SDK. A TypeScript parser accepts everything the compiler
 * might, and leaves the compiler as the one judge of what the subset is.
 *
 * Types are not values: `ast-walk.ts#walk` steps over every annotation and type declaration, so a
 * rewrite never mistakes a type name for a read of a variable.
 */
import { Parser, type Options } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";

import type { AstNode } from "./ast-walk.js";

const SauceParser = Parser.extend(tsPlugin());

/** `locations` is the plugin's requirement, not a rewrite's: every rewrite uses `start`/`end`. */
const OPTIONS: Options = { ecmaVersion: "latest", sourceType: "module", locations: true };

/** Parses a SauceScript module. A syntax error is acorn's `SyntaxError`, with its position. */
export function parseSauce(source: string): AstNode {
  return SauceParser.parse(source, OPTIONS) as unknown as AstNode;
}

/** Parses the single expression starting at `offset` of `source`. */
export function parseSauceExpression(source: string, offset = 0): AstNode {
  return SauceParser.parseExpressionAt(source, offset, OPTIONS) as unknown as AstNode;
}

/**
 * SDK Test Helpers
 *
 * Compilation utilities for testing SauceScript functions. Handles ABI import resolution from
 * TypeScript source files, since the compiler resolves a contract import as JSON.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'node:module';
import { join } from 'path';
import ts from 'typescript';
import { ensureVoidMain } from '../src/routes/rs-compile.js';
import { keccak256, toBytes, toHex } from 'viem';
import type { CompileResult as RustCompileResult, SauceTarget } from 'sauce-compiler';

// The SauceScript compiler: the published `@eco-incorp/sauce-compiler`, imported under the short
// name `sauce-compiler` because the in-repo workspace package still holds the scoped
// name (`@eco-incorp/sauce-compiler`) when the alias was introduced. Required via `createRequire` for the same reason
// `test/std/token/harness.ts` does: the package's `node` condition is a CommonJS build that reads
// its sibling `.wasm` off disk at load, and jest's ESM transform does not resolve that sibling.
const { compile: compileRust } = createRequire(import.meta.url)('sauce-compiler') as {
  compile: (options: {
    target: SauceTarget;
    entry?: string;
    resolve: (path: string) => Uint8Array | undefined;
    defines?: Array<[name: string, value: string]>;
    inlineContracts?: Array<[name: string, abi: string]>;
  }) => RustCompileResult;
};

/** The option surface the real-compile suites already call with. */
export interface CompileProgramOptions extends CompileSourceOptions {
  /** `'v1'`/`'v12'` are the same EVM backend; `'svm'` maps through. Defaults to `'evm'`. */
  target?: 'v1' | 'v12' | 'evm' | 'svm';
  /** Contract bindings holding a PARSED ABI, as `protocol-rewrite.ts` synthesizes them. */
  contracts?: Readonly<Record<string, { abi: unknown }>>;
  /** Accepted and ignored: the compiler always constant-folds, and has no compile cache to bypass. */
  treeshake?: boolean;
  /** Accepted and ignored — see `treeshake`. */
  cache?: boolean;
}

/**
 * Compile one program and return its bytecode as a SEGMENT LIST.
 *
 * The compiler emits exactly one program, but these suites were written against a segmented result
 * and index `bytecode[0]`; wrapping here keeps that call shape in one place instead of touching
 * every assertion. There is no `warnings` channel — a real problem throws — so it is always empty.
 */
export function compileProgram(
  source: string,
  { target = 'evm', baseDirs, contracts, defines }: CompileProgramOptions = {},
): { bytecode: Uint8Array[]; warnings: string[] } {
  const entry = 'main.js';
  const resolve = (path: string): Uint8Array | undefined => {
    const key = path.replace(/^\.\//, '');
    if (key === entry) return Buffer.from(ensureVoidMain(source));
    for (const dir of baseDirs ?? []) {
      const full = join(dir, key);
      if (existsSync(full)) return readFileSync(full);
    }

    return undefined;
  };

  const inline = Object.entries(contracts ?? {}).map(([name, cfg]) => [name, JSON.stringify(cfg.abi)] as [string, string]);
  const { bytecode } = compileRust({
    target: target === 'svm' ? 'svm' : 'evm',
    entry,
    resolve,
    ...(inline.length > 0 ? { inlineContracts: inline } : {}),
    ...(defines ? { defines: Object.entries(defines).map(([k, v]) => [k, v.toString()] as [string, string]) } : {}),
  });

  return { bytecode: [bytecode], warnings: [] };
}

export interface CompileSourceOptions {
  /** Roots a non-entry import (e.g. `./artifacts/IERC20.json`) is resolved against, in order. */
  baseDirs?: readonly string[];
  /** Compile-time consts, as the builders pass them. */
  defines?: Readonly<Record<string, bigint | number | string>>;
}

/**
 * Compile a complete SauceScript program through the Rust compiler, resolving any non-entry import
 * off disk against `baseDirs` — the shared seam the real-compile suites use, so the whole corpus
 * loads the wasm module once and states its resolve rules in one place.
 */
export function compileSource(
  source: string,
  target: SauceTarget,
  { baseDirs = [], defines }: CompileSourceOptions = {},
): RustCompileResult {
  const entry = 'main.js';
  const resolve = (path: string): Uint8Array | undefined => {
    const key = path.replace(/^\.\//, '');
    if (key === entry) return Buffer.from(ensureVoidMain(source));
    for (const dir of baseDirs) {
      const full = join(dir, key);
      if (existsSync(full)) return readFileSync(full);
    }

    return undefined;
  };

  return compileRust({
    target,
    entry,
    resolve,
    ...(defines ? { defines: Object.entries(defines).map(([k, v]) => [k, v.toString()] as [string, string]) } : {}),
  });
}

/**
 * Strip TypeScript type annotations from SauceScript, returning plain JS.
 */
function stripTypes(source: string): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
  return result.outputText;
}

/**
 * Parsed import: `import { ExportName as LocalName } from "./abis"`
 */
interface ParsedImport {
  exportName: string;
  localName: string;
  source: string;
}

/**
 * Parse SauceScript import statements.
 * Extracts `import { Foo as Bar } from "./abis"` patterns.
 */
function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const specifiers = match[1];
    const importSource = match[2];
    // Parse each specifier: "Foo as Bar" or just "Foo"
    for (const spec of specifiers.split(',')) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        imports.push({ exportName: asMatch[1], localName: asMatch[2], source: importSource });
      } else {
        imports.push({ exportName: trimmed, localName: trimmed, source: importSource });
      }
    }
  }
  return imports;
}

/**
 * Strip import lines from SauceScript source.
 */
function stripImports(source: string): string {
  return source.replace(/import\s*\{[^}]+\}\s*from\s*["'][^"']+["']\s*;?\s*\n?/g, '');
}

/**
 * Evaluate exported const arrays from a TypeScript source file.
 * Strips `as const`, type annotations, and `export` to extract plain JS objects.
 * Uses a safe Function constructor approach (no eval of arbitrary code).
 */
function extractExportsFromTs(tsSource: string): Record<string, unknown> {
  // Strip TypeScript-specific syntax
  let js = tsSource;
  // Remove `import type ...` lines
  js = js.replace(/^\s*import\s+type\s+[^;]*;?\s*$/gm, '');
  // Remove `satisfies TypeName`
  js = js.replace(/\s+satisfies\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?/g, '');
  // Remove `as const`
  js = js.replace(/\s+as\s+const\b/g, '');
  // Remove type annotations on declarations: `const x: Type = ...`
  js = js.replace(
    /((?:const|let|var)\s+\w+)\s*:\s*(?:readonly\s+)?[A-Za-z_$][\w$.<>|&\[\]\s]*(?:\[\])?\s*(?==)/g,
    '$1 ',
  );

  // Extract all `export const NAME = VALUE;` patterns
  const exports: Record<string, unknown> = {};
  // Match export const declarations and evaluate them
  const exportRegex = /export\s+const\s+(\w+)\s*=\s*/g;
  let match;
  while ((match = exportRegex.exec(js)) !== null) {
    const name = match[1];
    const startIdx = match.index + match[0].length;
    // Find the balanced end of the value (handle nested brackets)
    const value = extractBalancedValue(js, startIdx);
    if (value !== null) {
      try {
        // Safe evaluation of pure data literals
        const fn = new Function(`return (${value})`);
        exports[name] = fn();
      } catch {
        // Skip values that can't be evaluated
      }
    }
  }
  return exports;
}

/**
 * Extract a balanced JS value starting at the given index.
 * Handles nested arrays/objects with bracket counting.
 */
function extractBalancedValue(source: string, startIdx: number): string | null {
  let depth = 0;
  let inString: string | null = null;
  let i = startIdx;

  // Skip leading whitespace
  while (i < source.length && /\s/.test(source[i])) i++;

  const valueStart = i;
  const openChar = source[i];

  if (openChar === '[' || openChar === '{') {
    const closeChar = openChar === '[' ? ']' : '}';
    depth = 1;
    i++;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (inString) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === inString) inString = null;
      } else {
        if (ch === '"' || ch === "'" || ch === '`') inString = ch;
        else if (ch === openChar) depth++;
        else if (ch === closeChar) depth--;
      }
      i++;
    }
    if (depth !== 0) return null;
    return source.slice(valueStart, i);
  }

  // Simple value — read until semicolon or newline
  while (i < source.length && source[i] !== ';' && source[i] !== '\n') i++;
  return source.slice(valueStart, i).trim();
}

/**
 * Load ABI exports from a protocol's abis.ts file.
 */
function loadProtocolAbis(protocolDir: string): Record<string, unknown> {
  const abisPath = join(protocolDir, 'abis.ts');
  const tsSource = readFileSync(abisPath, 'utf-8');
  return extractExportsFromTs(tsSource);
}

/**
 * Compile a SauceScript program with the RUST compiler — the one the corpus is written for, and
 * the one that will consume it downstream.
 *
 * A template's `import { SomeABI as IFoo } from "./abis"` is a CONTRACT import there: the
 * specifier resolves to ABI JSON rather than to a module, so the resolver serves the named export
 * of the protocol's `abis.ts` at that path. Compilation failure throws.
 */
export function compileSauceFunctionRust(
  sauceScript: string,
  protocolDir: string,
  target: SauceTarget = 'evm',
): RustCompileResult {
  const [contractImport] = parseImports(sauceScript);
  const abi = contractImport
    ? (loadProtocolAbis(protocolDir)[contractImport.exportName] as unknown[] | undefined)
    : undefined;

  if (contractImport && !abi) {
    throw new Error(`ABI export "${contractImport.exportName}" not found in ${protocolDir}/abis.ts`);
  }

  const entry = 'main.js';
  // A miss is `undefined` — the "nothing at this path" signal — never a throw, which would mean
  // "present but unreadable" and would stop the compiler falling back.
  const resolve = (path: string): Uint8Array | undefined => {
    const key = path.startsWith('./') ? path.slice(2) : path;
    if (key === entry) return Buffer.from(sauceScript);
    if (contractImport && key === contractImport.source.replace(/^\.\//, '')) {
      return Buffer.from(JSON.stringify(abi));
    }

    return undefined;
  };

  return compileRust({ target, entry, resolve });
}

/**
 * Extract 4-byte function selectors from compiled bytecode segments.
 * Selectors appear as the first 4 bytes of ABI-encoded CALL data within the bytecode.
 */
export function extractSelectors(bytecode: Uint8Array | Uint8Array[]): string[] {
  const selectors: string[] = [];
  for (const segment of Array.isArray(bytecode) ? bytecode : [bytecode]) {
    // Look for CALL opcode patterns that contain 4-byte selectors
    // In Sauce bytecode, selectors are embedded as BYTE_4 (opcode 0x04) followed by 4 bytes
    for (let i = 0; i < segment.length - 4; i++) {
      if (segment[i] === 0x04) {
        // BYTE_4 opcode: next 4 bytes are the selector
        const sel = toHex(segment.slice(i + 1, i + 5));
        if (!selectors.includes(sel)) {
          selectors.push(sel);
        }
      }
    }
  }
  return selectors;
}

/**
 * Compute the 4-byte function selector from a Solidity function signature.
 *
 * @param signature - e.g. "transfer(address,uint256)"
 * @returns The 4-byte selector as hex string, e.g. "0xa9059cbb"
 */
export function computeSelector(signature: string): string {
  const hash = keccak256(toBytes(signature));
  return hash.slice(0, 10); // "0x" + 8 hex chars = 4 bytes
}

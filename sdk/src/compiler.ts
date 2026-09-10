/**
 * `@eco-incorp/sauce/compiler` — the published SauceScript compiler.
 *
 * This subpath used to serve the in-repo TypeScript compiler. It now serves the published Rust/wasm
 * one, which is the only compiler the SDK itself uses. The surface is different, not a superset: the
 * TS compiler exposed an opcode-level builder (`Saucer`, `CompilerContext`, `OPS`) alongside
 * `compile(source, options)`; this exposes `compile(options)` over source text and nothing else.
 *
 * `createRequire` rather than a static import: the package's `node` condition is a CommonJS build
 * that reads its sibling `.wasm` off disk at load, which an ESM transform does not resolve.
 */
import { createRequire } from "node:module";

export type {
  AccountEntry,
  AccountManifest,
  AccountRole,
  CompileOptions,
  CompileResult,
  ResolveModule,
  ResolvePackage,
  SauceTarget,
} from "sauce-compiler";

const mod = createRequire(import.meta.url)("sauce-compiler") as typeof import("sauce-compiler");

export const { compile } = mod;

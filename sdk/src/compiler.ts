/**
 * `@eco-incorp/sauce/compiler` — the published SauceScript compiler.
 *
 * This subpath used to serve the in-repo TypeScript compiler. It now serves the published Rust/wasm
 * one, which is the only compiler the SDK itself uses. The surface is different, not a superset: the
 * TS compiler exposed an opcode-level builder (`Saucer`, `CompilerContext`, `OPS`) alongside
 * `compile(source, options)`; this exposes `compile(options)` over source text.
 *
 * The same module runs in Node and in a browser (`wasm-compiler.ts`). In a browser, `await ready()`
 * once before the first compile; in Node `compile` works on import.
 */
export { resolveSdkModule, resolveSdkPackage } from "./embedded/resolve.js";
export { compile, ready, type WasmSource } from "./wasm-compiler.js";

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

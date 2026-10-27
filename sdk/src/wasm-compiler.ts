/**
 * The SDK's one import of the SauceScript compiler — `sauce-compiler`, the published
 * `@eco-incorp/sauce-compiler` WebAssembly package. Every compile the SDK runs goes through here.
 *
 * A plain ESM import, so the package's own `exports` conditions choose its build: `node` for Node,
 * `browser` (or `default`) for a bundler. It is one code path over two builds of the same wasm,
 * which differ in one respect. The Node build instantiates its wasm while it loads, so `compile`
 * works at once, as it always has. The browser build cannot fetch synchronously: `ready()`
 * initializes it, and until that has resolved every compile throws `NOT_READY` — the SDK's own
 * message, instead of the glue's `TypeError` about an undefined `wasm`.
 */
import {
  compile as compileWasm,
  functionCacheStats,
  type CompileOptions,
  type CompileResult,
} from "sauce-compiler";
import { ready as readyWasm, type WasmSource } from "sauce-compiler/ready";

export type { WasmSource };

const NOT_READY =
  "The SauceScript compiler's WebAssembly is not initialized: `await ready()` (exported by " +
  "@eco-incorp/sauce and @eco-incorp/sauce/compiler) before compiling. A browser loads the wasm " +
  "asynchronously; in Node it is ready on import.";

let initialized = false;

/**
 * Initialize the compiler's WebAssembly where the environment needs it, once.
 *
 * In a browser, with no `source`, the wasm is fetched from beside the compiler's own module —
 * the `new URL("sauce_wasm_bg.wasm", import.meta.url)` a bundler rewrites to an asset URL. Pass the
 * bytes (an `ArrayBuffer` or typed array) or a URL where that does not apply. In Node this resolves
 * at once and ignores `source`. Safe to call repeatedly and concurrently; a failed attempt is not
 * remembered, so calling again retries.
 */
export async function ready(source?: WasmSource): Promise<void> {
  await readyWasm(source);
  initialized = true;
}

/** Throws `NOT_READY` unless the wasm is usable. The probe is the cheapest export that reaches it. */
function assertReady(): void {
  if (initialized) return;
  try {
    functionCacheStats();
  } catch (cause) {
    throw new Error(NOT_READY, { cause });
  }
  initialized = true;
}

/**
 * The SGR escapes the compiler's report sets its headlines in bold with, whatever the terminal: not
 * part of its words, and noise in a log, JSON or a tool's result.
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Compile a SauceScript program to Sauce bytecode — the compiler's own `compile`, after a check
 * that its wasm is initialized. Synchronous in every environment once `ready()` has resolved, and
 * in Node without it. A failure is the compiler's own error, its `message` (and `stack`) plain
 * text, its `diagnostics` as the compiler gave them.
 */
export function compile(options: CompileOptions): CompileResult {
  assertReady();
  try {
    return compileWasm(options);
  } catch (error) {
    if (error instanceof Error) {
      error.message = error.message.replace(SGR, "");
      if (error.stack !== undefined) error.stack = error.stack.replace(SGR, "");
    }
    throw error;
  }
}

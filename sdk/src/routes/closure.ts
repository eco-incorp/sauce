/**
 * Closure route bodies — `() => {...}` accepted as a `SauceBody` alongside a string.
 *
 * `Function.prototype.toString.call(fn)` returns the closure's declared text (ES2018 guarantees it),
 * and that text is the program: the compiler takes it as the entry verbatim (`entryKind:
 * "closure"`), so its block is `main`'s body, a concise body `main`'s `return`, and a function the
 * block declares at its own top level a module function. Nothing here parses, slices or wraps it;
 * every diagnostic is located in the closure's own text.
 *
 * CAPTURE: there is none, by construction, and that is CORRECT — a free identifier that is neither
 * a chain's manifest name nor a caller-supplied `defines` entry is a hard "`X` is not a declared
 * variable" compile error, which can never silently bake a stale JS value into bytecode.
 */
export type SauceBody = string | (() => unknown);

class SauceClosureError extends Error {}

function fail(message: string): never {
  throw new SauceClosureError(`closure route body: ${message}`);
}

/**
 * The text a closure route body is compiled from: its own declared source, refused when the runtime
 * no longer has it, and when it declares parameters a route has no arguments for.
 */
export function closureSource(body: () => unknown): string {
  if (typeof body !== "function") {
    fail(`expected a function, got ${typeof body}`);
  }
  const text = Function.prototype.toString.call(body) as string;
  if (text.includes("[native code]")) {
    fail(
      "the closure's own toString() returned '[native code]' -- this can happen for a bound/proxied " +
        "function, or under a hostile minifier that strips function bodies; pass a string instead.",
    );
  }
  if (body.length > 0) {
    fail(
      "a closure with parameters is not supported -- a route body is called with no arguments; " +
        "write a zero-parameter closure or pass a string instead",
    );
  }

  return text;
}

/** True for a closure body, which compiles as `entryKind: "closure"`, rather than a source string. */
export function isSauceClosure(body: SauceBody): body is () => unknown {
  return typeof body === "function";
}

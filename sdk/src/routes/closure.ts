/**
 * Closure route bodies — `() => {...}` accepted as a `SauceBody` alongside a string.
 *
 * The closure is never invoked and never parsed here: its own declared text,
 * `Function.prototype.toString`'s (ES2018-spec-guaranteed verbatim), is handed to the compiler as
 * the entry with `entryKind: "closure"`, which compiles it as it stands — its block as `main`'s
 * body, a concise body as `main`'s `return`, a function declared at the top of its block as a
 * module function — and locates every diagnostic in that text.
 *
 * CAPTURE: there is none, by construction, and that is CORRECT — a free identifier that is neither
 * a name the chain declares nor a caller-supplied `defines` entry is the compiler's unknown-name
 * error, which can never silently bake a stale JS value into bytecode.
 */
export type SauceBody = string | (() => unknown);

class SauceClosureError extends Error {}

/** The closure's own declared text, as the compiler's `"closure"` entry takes it. */
export function closureText(body: () => unknown): string {
  if (typeof body !== "function") {
    throw new SauceClosureError(`closureText: expected a function, got ${typeof body}`);
  }
  const text = Function.prototype.toString.call(body) as string;
  if (text.includes("[native code]")) {
    throw new SauceClosureError(
      "closureText: the closure's own toString() returned '[native code]' -- this can happen for a " +
        "bound/proxied function, or under a hostile minifier that strips function bodies; pass a " +
        "string instead.",
    );
  }

  return text;
}

/** True for a closure body, which `closureText` (rather than the plain string path) handles. */
export function isSauceClosure(body: SauceBody): body is () => unknown {
  return typeof body === "function";
}

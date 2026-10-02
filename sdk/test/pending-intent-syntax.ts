/**
 * The suites' view of PENDING_INTENT_SYNTAX (`docs/scripts/pending-intent-syntax.json`, which
 * `docs/scripts/example-programs.mjs` reads for the checkers): the examples written in the Portal
 * intent syntax ahead of the compiler. A suite that executes one of them skips it while it is
 * listed, and runs `stillPending` in its place, which fails as STALE once the file compiles.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/scripts/pending-intent-syntax.json",
);

const PENDING = JSON.parse(readFileSync(LIST, "utf8")) as {
  readonly why: string;
  readonly files: readonly string[];
  readonly claims: Readonly<Record<string, string>>;
};

/** Whether `file` (relative to the repository) is written in the syntax the compiler lacks. */
export const pendingIntentSyntax = (file: string): boolean => PENDING.files.includes(file);

/** Whether `page`'s claims about the lowering wait for that syntax. */
export const pendingIntentClaim = (page: string): boolean => Object.hasOwn(PENDING.claims, page);

/** The failure of a listed entry that compiles, or holds, now. */
export const staleIntentSyntax = (what: string): string =>
  `${what} is listed in PENDING_INTENT_SYNTAX (docs/scripts/pending-intent-syntax.json) but ` +
  `compiles now: remove its entry, and run what it skipped (${PENDING.why})`;

/**
 * Asserts that `what`, listed as pending, still does not compile: `compile` must throw. Once it
 * does not, the entry is stale and this fails, naming it.
 */
export function stillPending(what: string, compile: () => unknown): void {
  let compiled = true;
  try {
    compile();
  } catch {
    compiled = false;
  }
  if (compiled) throw new Error(staleIntentSyntax(what));
}

/**
 * The questions the `sauce` command asks at a terminal — a line of text, or one choice of a
 * numbered list — over the injected `ask` (`run.ts#nodeIo` reads it with `node:readline`, the same
 * way it asks yes or no), so a test answers them and no prompt dependency is needed.
 *
 * Every question has the flag that answers it instead: with no terminal, a command that still
 * lacks an answer fails naming each missing flag (`missingFlags`), rather than waiting on input
 * that will not come.
 */
import { CliError, UsageError } from "./args.js";

/** Asks `question` and returns the line typed; `undefined` where there is no terminal. */
export type Ask = (question: string) => Promise<string | undefined>;

/** One choice of a list: what is shown, and what choosing it returns. */
export interface Choice<T> {
  readonly label: string;
  readonly value: T;
}

/** How many times a question is asked again after an answer it cannot use. */
const RETRIES = 3;

/**
 * A line of text, or `fallback` when the line is empty. `check` returns why an answer cannot be
 * used, and the question is asked again; `undefined` with no terminal.
 */
export async function askText(
  ask: Ask,
  question: string,
  options: {
    readonly fallback?: string;
    readonly check?: (answer: string) => string | undefined;
  } = {},
): Promise<string | undefined> {
  const shown =
    options.fallback === undefined ? `${question}: ` : `${question} [${options.fallback}]: `;
  let problem: string | undefined;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const raw = await ask(problem === undefined ? shown : `  (${problem})\n${shown}`);
    if (raw === undefined) return undefined;
    const answer = raw.trim() === "" ? (options.fallback ?? "") : raw.trim();
    problem = answer === "" ? "an answer is needed" : options.check?.(answer);
    if (problem === undefined) return answer;
  }

  throw new CliError(`${question.split("\n")[0]}: ${problem}`);
}

/** One of `choices`, by number; `undefined` with no terminal. */
export async function askChoice<T>(
  ask: Ask,
  question: string,
  choices: readonly Choice<T>[],
  fallback?: number,
): Promise<T | undefined> {
  if (choices.length === 0) throw new CliError(`${question}: there is nothing to choose from`);
  const menu = choices.map(
    (choice, index) => `  ${String(index + 1).padStart(2)}. ${choice.label}`,
  );
  const answer = await askText(ask, `${question}\n${menu.join("\n")}\nChoose 1-${choices.length}`, {
    ...(fallback === undefined ? {} : { fallback: String(fallback + 1) }),
    check: (text) => {
      const index = Number(text);

      return Number.isInteger(index) && index >= 1 && index <= choices.length
        ? undefined
        : `'${text}' is not a number from 1 to ${choices.length}`;
    },
  });

  return answer === undefined ? undefined : choices[Number(answer) - 1]!.value;
}

/** The refusal of a command run with no terminal and questions still open: each missing flag. */
export function missingFlags(command: string, flags: readonly string[]): UsageError {
  return new UsageError(
    `${command} has no terminal to ask on, and needs ${flags.join(", ")}: pass ` +
      (flags.length === 1 ? "it" : "them") +
      " as flags",
  );
}

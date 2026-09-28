/**
 * The rules an action list must satisfy beyond each action's own shape: where every amount comes
 * from, and that every value a source action produces is read. `program.ts` runs the structural
 * checks first, so by the time these run every field has its declared type.
 */
import { ACTION_SPECS } from "./spec.js";
import type { Action } from "./types.js";

/** One problem with a program, located by a path into the document (`actions[2].amountRef`). */
export interface ProgramIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown for a program that breaks any rule. `issues` lists every problem found, in order. */
export class ProgramError extends Error {
  readonly issues: readonly ProgramIssue[];

  constructor(issues: readonly ProgramIssue[]) {
    super(
      `invalid action program (${issues.length} ${issues.length === 1 ? "issue" : "issues"}):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ProgramError";
    this.issues = issues;
  }
}

/** A chaining name becomes a SauceScript local, so it has to be spellable as one. */
export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function field(action: Action, key: "amount" | "amountRef"): string | undefined {
  return (action as { amount?: string; amountRef?: string })[key];
}

/** True when `action` spends the previous action's output: it could take an amount, and has none. */
export function consumesPrevious(action: Action): boolean {
  return (
    ACTION_SPECS[action.type].spends &&
    field(action, "amount") === undefined &&
    field(action, "amountRef") === undefined
  );
}

/** Every rule `actions` breaks. */
export function programIssues(actions: readonly Action[]): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  const at = (i: number, key?: string): string =>
    key === undefined ? `actions[${i}]` : `actions[${i}].${key}`;
  const saved = new Set<string>();
  const argumentNames = new Map<string, number>();

  actions.forEach((action, i) => {
    const ref = field(action, "amountRef");
    if (ref !== undefined && field(action, "amount") !== undefined) {
      issues.push({
        path: at(i, "amountRef"),
        message: "both `amount` and `amountRef` are set — an action spends one amount; remove one",
      });
    } else if (ref !== undefined && !saved.has(ref)) {
      issues.push({
        path: at(i, "amountRef"),
        message: `'${ref}' is not saved by an earlier action (set \`saveOutputAs: "${ref}"\` on one before this)`,
      });
    }
    if (consumesPrevious(action) && i === 0) {
      issues.push({
        path: at(i),
        message:
          "has no amount: set `amount` or `amountRef`, or put an action before it whose output it spends",
      });
    }

    if (action.type === "argument") {
      const first = argumentNames.get(action.name);
      if (first !== undefined) {
        issues.push({
          path: at(i, "name"),
          message: `argument '${action.name}' is already declared by actions[${first}]`,
        });
      }
      argumentNames.set(action.name, first ?? i);
    }

    if (action.saveOutputAs !== undefined) saved.add(action.saveOutputAs);
  });

  // A source action exists only to feed a later one. Unread, it is almost certainly a mistake.
  actions.forEach((action, i) => {
    if (ACTION_SPECS[action.type].group !== "source") return;
    const next = actions[i + 1];
    const name = action.saveOutputAs;
    const read =
      (next !== undefined && consumesPrevious(next)) ||
      (name !== undefined &&
        actions.slice(i + 1).some((later) => field(later, "amountRef") === name));
    if (!read) {
      issues.push({
        path: at(i),
        message:
          `the value this ${action.type} produces is never read — the next action must omit its ` +
          "amount to spend it, or a later action must reference it by `amountRef`",
      });
    }
  });

  return issues;
}

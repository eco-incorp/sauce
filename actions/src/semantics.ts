/**
 * The rules an action list must satisfy beyond each action's own shape: which chain it runs on,
 * where every amount comes from, and that every value a source action produces is read.
 *
 * Shared by the typed path (`actionsToSauce(actions)`) and the JSON path (`parseActionProgram`),
 * so a program is held to the same rules however it was built. The JSON path runs the structural
 * checks in `program.ts` first, so by the time these run every field has its declared type.
 */
import { ACTION_SPECS } from "./spec.js";
import type { RoutingAction } from "./types.js";

/** One problem with a program, located by a JSON-pointer-like path (`actions[2].amountRef`). */
export interface ActionIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown for a program that breaks any rule. `issues` lists every problem found, in order. */
export class ActionProgramError extends Error {
  readonly issues: readonly ActionIssue[];

  constructor(issues: readonly ActionIssue[]) {
    super(
      `invalid action program (${issues.length} ${issues.length === 1 ? "issue" : "issues"}):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ActionProgramError";
    this.issues = issues;
  }
}

/** A chaining name becomes a SauceScript local, so it has to be spellable as one. */
export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isSourceAction(action: RoutingAction): boolean {
  return ACTION_SPECS[action.type].group === "source";
}

/** The field an action's explicit amount lives in, when it has one. */
export function amountFieldOf(action: RoutingAction): string | undefined {
  return ACTION_SPECS[action.type].amountField;
}

/** The explicit amount an action carries, if any — `steps[0].amount` for a Balancer batch. */
export function explicitAmountOf(action: RoutingAction): string | undefined {
  if (action.type === "balancerV2BatchSwap") return action.steps[0]?.amount;
  const field = amountFieldOf(action);
  if (field === undefined) return undefined;

  return (action as unknown as Record<string, string | undefined>)[field];
}

function amountRefOf(action: RoutingAction): string | undefined {
  return "amountRef" in action ? action.amountRef : undefined;
}

/** True when `action` spends the previous action's output: it has no amount and no reference. */
export function consumesPrevious(action: RoutingAction): boolean {
  return (
    !isSourceAction(action) &&
    explicitAmountOf(action) === undefined &&
    amountRefOf(action) === undefined
  );
}

/** Integral places an order that settles in a later transaction, so it has no output to chain. */
function producesOutput(action: RoutingAction): boolean {
  return ACTION_SPECS[action.type].output !== "none";
}

/** The chain an action executes on — a bridge's source chain. */
export function executionChainOf(action: RoutingAction): number {
  return "srcChainId" in action ? action.srcChainId : action.chainId;
}

/**
 * Every rule violation in `actions`. `chainId` is the program's chain when there is one; a bare
 * list is held to the chain of its first action.
 */
export function actionsSemanticIssues(
  actions: readonly RoutingAction[],
  chainId?: number,
): ActionIssue[] {
  const issues: ActionIssue[] = [];
  const at = (i: number, field?: string): string =>
    field === undefined ? `actions[${i}]` : `actions[${i}].${field}`;
  const expectedChain = chainId ?? (actions[0] ? executionChainOf(actions[0]) : undefined);

  const saved = new Map<string, number>();
  const argumentNames = new Map<string, number>();

  actions.forEach((action, i) => {
    const chainField = "srcChainId" in action ? "srcChainId" : "chainId";
    const chain = executionChainOf(action);
    if (expectedChain !== undefined && chain !== expectedChain) {
      issues.push({
        path: at(i, chainField),
        message:
          `executes on chain ${chain}, but the program executes on chain ${expectedChain} — every ` +
          "action runs in the same transaction on one chain; a bridge's destination is `destChainId`",
      });
    }

    const ref = amountRefOf(action);
    const explicit = explicitAmountOf(action);
    const amountField = amountFieldOf(action);

    for (const [field, name] of [
      ["saveOutputAs", action.saveOutputAs],
      ["amountRef", ref],
      ...(action.type === "argument" ? [["name", action.name] as const] : []),
    ] as const) {
      if (name !== undefined && !IDENTIFIER_RE.test(name)) {
        issues.push({
          path: at(i, field),
          message: `'${name}' must be a valid identifier ([A-Za-z_$][A-Za-z0-9_$]*) — it becomes a local variable in the emitted SauceScript`,
        });
      }
    }

    if (action.type === "argument") {
      const first = argumentNames.get(action.name);
      if (first !== undefined) {
        issues.push({
          path: at(i, "name"),
          message: `argument '${action.name}' is already declared by actions[${first}]`,
        });
      } else {
        argumentNames.set(action.name, i);
      }
    }

    if (action.type === "balancerV2BatchSwap" && ref !== undefined) {
      issues.push({
        path: at(i, "amountRef"),
        message:
          "a Balancer batch swap cannot take a referenced amount — every step's `amount` is " +
          "explicit (a later step's 0 means the previous step's output); set `steps[0].amount`",
      });
    } else if (ref !== undefined && explicit !== undefined) {
      issues.push({
        path: at(i, "amountRef"),
        message: `both \`${amountField}\` and \`amountRef\` are set — an action takes one amount; remove one`,
      });
    } else if (ref !== undefined && !saved.has(ref)) {
      issues.push({
        path: at(i, "amountRef"),
        message: `'${ref}' is not saved by an earlier action (set \`saveOutputAs: "${ref}"\` on one before this)`,
      });
    }

    if (consumesPrevious(action)) {
      const previous = actions[i - 1];
      if (previous === undefined) {
        issues.push({
          path: at(i),
          message: `has no amount: set \`${amountField}\`, an \`amountRef\`, or put an action before it whose output it spends`,
        });
      } else if (!producesOutput(previous)) {
        issues.push({
          path: at(i),
          message: `has no amount, and the previous action (${previous.type}) produces no output to spend — set \`${amountField}\` or an \`amountRef\``,
        });
      }
    }

    if (!producesOutput(action) && action.saveOutputAs !== undefined) {
      issues.push({
        path: at(i, "saveOutputAs"),
        message: `${action.type} produces no output in this transaction (the order executes later), so there is nothing to save`,
      });
    }

    if (action.saveOutputAs !== undefined) saved.set(action.saveOutputAs, i);
  });

  // A source action exists only to feed a later one. Unread, it is almost certainly a mistake.
  actions.forEach((action, i) => {
    if (!isSourceAction(action)) return;
    const next = actions[i + 1];
    const readImplicitly = next !== undefined && consumesPrevious(next);
    const name = action.saveOutputAs;
    const readByName =
      name !== undefined && actions.slice(i + 1).some((later) => amountRefOf(later) === name);
    if (!readImplicitly && !readByName) {
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

/** Throws an `ActionProgramError` listing every rule `actions` breaks. */
export function assertActionsSemantics(actions: readonly RoutingAction[], chainId?: number): void {
  const issues = actionsSemanticIssues(actions, chainId);
  if (issues.length > 0) throw new ActionProgramError(issues);
}

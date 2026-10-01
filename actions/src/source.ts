/**
 * An action program as SauceScript for the `sauce` command's own commands: the one function the
 * command line and the MCP server (`sauce_actions`) both turn a JSON action document into a program
 * with, before compiling it, building its cook or rehearsing it exactly as they do a `.sauce.ts`
 * file. Whatever the lowering learns — new actions, names it resolves — reaches both through here.
 *
 * Not part of the `/actions` export: application code compiles a document with `compileProgram`.
 */
import type { SauceCompileOptions } from "../../sdk/dist/routes/index.js";

import { parseProgram } from "./program.js";
import { lowerActions, renderProgram } from "./to-sauce.js";
import type { ActionProgram } from "./types.js";

export interface ActionSource {
  /** The document, validated against the action-program schema's own field table. */
  readonly program: ActionProgram;
  /** `main`, with one `Uint256` parameter per `argument` action, in order. */
  readonly source: string;
  /** The ABI bindings the program calls through, as `SauceCompileOptions.contracts` takes them. */
  readonly contracts: NonNullable<SauceCompileOptions["contracts"]>;
  /** The `argument` actions' names, in the order `main` takes them. */
  readonly parameters: readonly string[];
}

/** `document` lowered to the program its actions run; throws `ProgramError` naming each issue. */
export function actionSource(document: unknown): ActionSource {
  const program = parseProgram(document);
  const lowered = lowerActions(program.actions);

  return {
    program,
    source: renderProgram(lowered),
    contracts: lowered.contracts as unknown as NonNullable<SauceCompileOptions["contracts"]>,
    parameters: lowered.parameters,
  };
}

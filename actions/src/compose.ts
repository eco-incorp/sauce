/**
 * An action program, compiled standalone or composed into an Eco intent.
 *
 * STANDALONE (`compileActions`). One compiled program; its `argument` actions are `main`
 * parameters, so the same bytecode serves every amount and the amounts travel as the argument
 * bytes appended to it. ABI-v1 arguments are 32-byte words; compact-v1 arguments are smaller, and
 * with a declared `scalarWidth` each sits at a fixed offset (`argumentOffset`), which is what lets a
 * caller splice a number measured at runtime into an otherwise precompiled payload.
 *
 * INTENT (`actionsIntent`, `actionsRouteBody`). The program is a route body: the SDK compiles it
 * for the destination, puts its cook in the route, and `.reward(...)` / `.nest(...)` work on it
 * like on any other. A route body takes no runtime arguments, so an amount only known at execution
 * comes from a `balanceOf` action instead — which is also how a child of a dynamic `.nest()` spends
 * exactly what its parent delivered.
 */
import { concatBytes, encodeAbiParameters, hexToBytes as viemHexToBytes } from "viem";

import { encodeCompactArguments } from "../../sdk/dist/compact-arguments.js";
import { requireChain, type ChainRef } from "../../sdk/dist/chains/index.js";
import {
  openRoute,
  type IntentOptions,
  type PendingSauceRoute,
  type SauceCompileOptions,
} from "../../sdk/dist/routes/index.js";

import type { ActionContracts } from "./abis.js";
import { compileEvm } from "./compile.js";
import { parseActionProgram } from "./program.js";
import { assembleActions, renderProgram, renderRouteBody } from "./to-sauce.js";
import type { ActionProgram, RoutingAction } from "./types.js";

/** A program document, or a bare action list (held to the chain of its first action). */
export type ActionsInput = ActionProgram | readonly RoutingAction[];

function actionsOf(input: ActionsInput): { actions: readonly RoutingAction[]; chainId?: number } {
  if (Array.isArray(input)) return { actions: input as readonly RoutingAction[] };
  const program = parseActionProgram(input);

  return { actions: program.actions, chainId: program.chainId };
}

export interface CompileActionsOptions {
  /** Encode `main`'s arguments compact-v1 instead of ABI-v1. Default `false`. */
  readonly compactArgs?: boolean;
}

export type ArgumentValues = Readonly<Record<string, bigint | number | string>>;

export interface ArgumentEncodingOptions {
  /**
   * Compact-v1 only: encode every scalar in exactly this many bytes (1..32) instead of the minimal
   * width, so each argument sits at a fixed offset whatever its value. ABI-v1 words are always 32.
   */
  readonly scalarWidth?: number;
}

export interface CompiledActions {
  readonly bytecode: Uint8Array;
  /** The standalone source that was compiled. */
  readonly source: string;
  /** The ABI bindings it was compiled with. */
  readonly contracts: ActionContracts;
  /** `argument` names, in the order `main` takes them. Empty when the program takes none. */
  readonly parameters: readonly string[];
  readonly entryEncoding: "abi-v1" | "compact-v1";
  /** The compact argument schema; present with `compactArgs`. */
  readonly entrySchema?: Uint8Array;
  /** The argument bytes for `values`, keyed by argument name. */
  encodeArguments(values?: ArgumentValues, options?: ArgumentEncodingOptions): Uint8Array;
  /** `bytecode` followed by the argument bytes — the `program` a Pot's `cook(engine, program)` takes. */
  payload(values?: ArgumentValues, options?: ArgumentEncodingOptions): Uint8Array;
  /**
   * Where argument `name`'s value starts in `payload(...)`, for splicing a number into a payload
   * built earlier. ABI-v1: its 32-byte word. Compact-v1: its `scalarWidth` value bytes, so a
   * `scalarWidth` is required. The value is big-endian either way.
   */
  argumentOffset(name: string, options?: ArgumentEncodingOptions): number;
}

/** Compiles an action program standalone. Its `argument` actions become `main` parameters. */
export function compileActions(
  input: ActionsInput,
  options: CompileActionsOptions = {},
): CompiledActions {
  const { actions, chainId } = actionsOf(input);
  const assembled = assembleActions(actions, chainId);
  const source = renderProgram(assembled);
  const result = compileEvm(source, assembled.contracts, { compactArgs: options.compactArgs });
  const { parameters } = assembled;
  const bytecode = result.bytecode;

  const ordered = (values: ArgumentValues = {}): bigint[] => {
    const unknown = Object.keys(values).filter((name) => !parameters.includes(name));
    if (unknown.length > 0) {
      throw new Error(
        `compileActions: no argument named ${unknown.map((n) => `'${n}'`).join(", ")}` +
          ` (the program takes ${parameters.length === 0 ? "none" : parameters.map((p) => `'${p}'`).join(", ")})`,
      );
    }

    return parameters.map((name) => {
      const value = values[name];
      if (value === undefined)
        throw new Error(`compileActions: missing a value for argument '${name}'`);
      const scalar = BigInt(value);
      if (scalar < 0n || scalar >= 1n << 256n) {
        throw new Error(`compileActions: argument '${name}' must be a uint256, got ${value}`);
      }

      return scalar;
    });
  };

  const encodeArguments = (
    values?: ArgumentValues,
    opts: ArgumentEncodingOptions = {},
  ): Uint8Array => {
    const positional = ordered(values);
    if (result.entryEncoding === "compact-v1") {
      return encodeCompactArguments(result.entrySchema!, positional, {
        scalarWidth: opts.scalarWidth,
      });
    }
    if (opts.scalarWidth !== undefined) {
      throw new Error(
        "compileActions: `scalarWidth` applies to compact-v1 arguments; compile with `compactArgs: true`",
      );
    }
    if (positional.length === 0) return new Uint8Array();

    return viemHexToBytes(
      encodeAbiParameters(
        positional.map(() => ({ type: "uint256" })),
        positional,
      ),
    );
  };

  return {
    bytecode,
    source,
    contracts: assembled.contracts,
    parameters,
    entryEncoding: result.entryEncoding,
    entrySchema: result.entrySchema,
    encodeArguments,
    payload: (values, opts) => concatBytes([bytecode, encodeArguments(values, opts)]),
    argumentOffset(name, opts = {}) {
      const index = parameters.indexOf(name);
      if (index < 0) throw new Error(`compileActions: no argument named '${name}'`);
      if (result.entryEncoding === "abi-v1") return bytecode.length + 32 * index;
      const width = opts.scalarWidth;
      if (width === undefined) {
        throw new Error(
          "compileActions: a compact-v1 argument has a fixed offset only under a declared `scalarWidth`",
        );
      }
      // "SA" + version (1) + flags (0), then per scalar a one-byte width and its value bytes.
      return bytecode.length + 4 + index * (1 + width) + 1;
    },
  };
}

/** An action program as an SDK route body, plus the ABI bindings its compile needs. */
export interface ActionRouteBody {
  /** A complete `function main() { … }` in the plain-JavaScript form route bodies take. */
  readonly source: string;
  /** Pass as `IntentOptions.compile.contracts` (or `compileSauceRoute`'s `contracts`). */
  readonly contracts: ActionContracts;
  /** The chain the actions execute on. */
  readonly chainId: number;
}

/** The route-body form of an action program. Throws for a program with `argument` actions. */
export function actionsRouteBody(input: ActionsInput): ActionRouteBody {
  const { actions, chainId } = actionsOf(input);
  if (actions.length === 0) throw new Error("actionsRouteBody: the program has no actions");
  const assembled = assembleActions(actions, chainId);
  const first = actions[0]!;

  return {
    source: renderRouteBody(assembled),
    contracts: assembled.contracts,
    chainId: chainId ?? ("srcChainId" in first ? first.srcChainId : first.chainId),
  };
}

/**
 * Merges the action bindings into `compile.contracts`, refusing a same-named binding with a
 * different ABI rather than letting one silently shadow the other.
 */
function withContracts(
  compile: SauceCompileOptions | undefined,
  contracts: ActionContracts,
): SauceCompileOptions {
  const existing = compile?.contracts ?? {};
  for (const [name, { abi }] of Object.entries(contracts)) {
    const other = existing[name];
    if (other !== undefined && JSON.stringify(other.abi) !== JSON.stringify(abi)) {
      throw new Error(
        `actionsIntent: compile.contracts already binds '${name}' to a different ABI — action ` +
          "programs reserve the I-prefixed binding names listed in `BINDING_NAMES`; rename yours",
      );
    }
  }

  return {
    ...compile,
    contracts: {
      ...existing,
      ...(contracts as unknown as NonNullable<SauceCompileOptions["contracts"]>),
    },
  };
}

/**
 * An action program as an Eco intent route on `destination`: `actionsIntent(chain, program,
 * options).reward(reward)` is `Base(body, options).reward(reward)` with the program's source as the
 * body and its bindings merged into `options.compile.contracts`.
 *
 * `destination` must be the program's chain. A program executes on one chain; moving value to
 * another is a bridge action inside it, or a nested intent (`.nest(...)`) on the returned route.
 */
export function actionsIntent(
  destination: ChainRef,
  input: ActionsInput,
  options: IntentOptions,
): PendingSauceRoute {
  const body = actionsRouteBody(input);
  const chain = requireChain(destination);
  if (chain.id !== body.chainId) {
    throw new Error(
      `actionsIntent: the program executes on chain ${body.chainId}, but the route's destination is ` +
        `${chain.slug} (${chain.id}) — build the intent for chain ${body.chainId}, or change the program's chainId`,
    );
  }

  return openRoute(chain, body.source, {
    ...options,
    compile: withContracts(options.compile, body.contracts),
  });
}

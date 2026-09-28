/**
 * An action program, compiled standalone or opened as an Eco intent route.
 *
 * STANDALONE (`compileProgram`). One compiled program; its `argument` actions are `main`
 * parameters, so the same bytecode serves every amount and the amounts travel as argument bytes
 * appended to it. ABI-v1 arguments are 32-byte words; compact-v1 arguments are smaller, and with a
 * declared `scalarWidth` each sits at a fixed offset (`argumentOffset`), which is what lets a caller
 * splice a number measured at runtime into an otherwise precompiled payload.
 *
 * INTENT (`programIntent`). The program is the route body on its own chain: the SDK compiles it
 * there, puts its cook in the route, and `.reward(...)` / `.nest(...)` work on it like on any other.
 * A route body takes no runtime arguments, so an amount only known at execution comes from a
 * `balanceOf` action instead — which is also how a child of a dynamic `.nest()` spends exactly what
 * its parent delivered.
 */
import { concatBytes, encodeAbiParameters, hexToBytes } from "viem";

import { encodeCompactArguments } from "../../sdk/dist/compact-arguments.js";
import {
  openRoute,
  type IntentOptions,
  type PendingSauceRoute,
  type SauceCompileOptions,
} from "../../sdk/dist/routes/index.js";

import type { ActionContracts } from "./abis.js";
import { compileEvm } from "./compile.js";
import { parseProgram } from "./program.js";
import { lowerActions, renderProgram, renderRouteBody } from "./to-sauce.js";
import type { ActionProgram } from "./types.js";

export interface CompileOptions {
  /** Encode the runtime arguments compact-v1 instead of ABI-v1. Default `false`. */
  readonly compactArgs?: boolean;
}

/** Runtime argument values, by `argument` name. Each is a uint256. */
export type ArgumentValues = Readonly<Record<string, bigint | number | string>>;

export interface ArgumentEncoding {
  /**
   * Compact-v1 only: encode every argument in exactly this many bytes (1..32) instead of the
   * minimal width, so each sits at a fixed offset whatever its value.
   */
  readonly scalarWidth?: number;
}

export interface CompiledProgram {
  readonly bytecode: Uint8Array;
  /** The SauceScript that was compiled. */
  readonly source: string;
  /** The `argument` names, in the order `main` takes them. Empty when there are none. */
  readonly parameters: readonly string[];
  readonly entryEncoding: "abi-v1" | "compact-v1";
  /** The compact-v1 argument schema; present with `compactArgs`. */
  readonly entrySchema?: Uint8Array;
  /** `bytecode` followed by the encoded arguments — the `program` a Pot's `cook(engine, program)` takes. */
  payload(values?: ArgumentValues, encoding?: ArgumentEncoding): Uint8Array;
  /**
   * Where argument `name`'s big-endian value starts in `payload(...)`, for splicing a number into
   * a payload built earlier: its 32-byte word under ABI-v1, its `scalarWidth` bytes under
   * compact-v1 (which requires a `scalarWidth`).
   */
  argumentOffset(name: string, encoding?: ArgumentEncoding): number;
}

/** Compiles an action program standalone. Its `argument` actions become runtime arguments. */
export function compileProgram(
  program: ActionProgram,
  options: CompileOptions = {},
): CompiledProgram {
  const lowered = lowerActions(parseProgram(program).actions);

  return compiled(renderProgram(lowered), lowered.contracts, lowered.parameters, options);
}

/** Compiles generated source into a `CompiledProgram`. */
export function compiled(
  source: string,
  contracts: ActionContracts,
  parameters: readonly string[],
  options: CompileOptions = {},
): CompiledProgram {
  const result = compileEvm(source, contracts, { compactArgs: options.compactArgs });
  const { bytecode } = result;

  const positional = (values: ArgumentValues = {}): bigint[] => {
    const unknown = Object.keys(values).filter((name) => !parameters.includes(name));
    if (unknown.length > 0) {
      throw new Error(
        `no argument named ${unknown.map((n) => `'${n}'`).join(", ")}` +
          ` (the program takes ${parameters.length === 0 ? "none" : parameters.map((p) => `'${p}'`).join(", ")})`,
      );
    }

    return parameters.map((name) => {
      const value = values[name];
      if (value === undefined) throw new Error(`missing a value for argument '${name}'`);
      const scalar = BigInt(value);
      if (scalar < 0n || scalar >= 1n << 256n) {
        throw new Error(`argument '${name}' must be a uint256, got ${value}`);
      }

      return scalar;
    });
  };

  const encodeArguments = (
    values?: ArgumentValues,
    encoding: ArgumentEncoding = {},
  ): Uint8Array => {
    const args = positional(values);
    if (result.entryEncoding === "compact-v1") {
      return encodeCompactArguments(result.entrySchema!, args, {
        scalarWidth: encoding.scalarWidth,
      });
    }
    if (encoding.scalarWidth !== undefined) {
      throw new Error("`scalarWidth` applies to compact-v1 arguments; compile with `compactArgs`");
    }
    if (args.length === 0) return new Uint8Array();

    return hexToBytes(
      encodeAbiParameters(
        args.map(() => ({ type: "uint256" })),
        args,
      ),
    );
  };

  return {
    bytecode,
    source,
    parameters,
    entryEncoding: result.entryEncoding,
    entrySchema: result.entrySchema,
    payload: (values, encoding) => concatBytes([bytecode, encodeArguments(values, encoding)]),
    argumentOffset(name, encoding = {}) {
      const index = parameters.indexOf(name);
      if (index < 0) throw new Error(`no argument named '${name}'`);
      if (result.entryEncoding === "abi-v1") return bytecode.length + 32 * index;
      const width = encoding.scalarWidth;
      if (width === undefined) {
        throw new Error("a compact-v1 argument has a fixed offset only under a `scalarWidth`");
      }
      // "SA" + version (1) + flags (0), then per scalar a one-byte width and its value bytes.
      return bytecode.length + 4 + index * (1 + width) + 1;
    },
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
        `compile.contracts already binds '${name}' to a different ABI — an action program binds ` +
          "its contracts under I-prefixed names such as this one; rename yours",
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
 * An action program as an Eco intent route on the program's own chain:
 * `programIntent(program, options).reward(reward)` is `Base(body, options).reward(reward)` with the
 * program as the body. Moving value to another chain is a bridge action inside the program, or a
 * nested intent (`.nest(...)`) on the returned route.
 */
export function programIntent(program: ActionProgram, options: IntentOptions): PendingSauceRoute {
  const { chainId, actions } = parseProgram(program);
  const lowered = lowerActions(actions);

  return openRoute(chainId, renderRouteBody(lowered), {
    ...options,
    compile: withContracts(options.compile, lowered.contracts),
  });
}

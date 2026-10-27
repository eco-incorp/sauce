/**
 * An action program, compiled standalone.
 *
 * `compileProgram`: one compiled program; its `argument` actions are `main` parameters, so the same
 * bytecode serves every amount and the amounts travel as argument bytes appended to it. ABI-v1
 * arguments are 32-byte words at fixed offsets (`argumentOffset`), which lets a caller splice a
 * number measured at runtime into an otherwise precompiled payload.
 *
 * THE CHAIN. It compiles for one chain: `options.chain`, else the document's `chainId`. The
 * program's token symbols and namespace references are its globals, and that compile resolves them
 * there — the SDK's own program compile, `routes.compileSauceProgram`, with the chain's names — so
 * a document with no `chainId` compiles for any chain where its names exist. A name the chain lacks
 * is refused first, with its path (`names.ts`).
 */
import { concatBytes, encodeAbiParameters, hexToBytes } from "viem";

import {
  resolveChain,
  type CanonicalChain,
  type ChainRef,
} from "../../sdk/dist/chains/canonical.js";
import { compileSauceProgram } from "../../sdk/dist/routes/index.js";

import type { ActionContracts } from "./abis.js";
import { compileEvm } from "./compile.js";
import { acrossOutputTokens, chainLabel, resolveNames, wrappedNativeIssues } from "./names.js";
import { parseProgram } from "./program.js";
import { ProgramError, programIssues } from "./semantics.js";
import { lowerActions, renderProgram, type Lowered } from "./to-sauce.js";
import type { ActionProgram } from "./types.js";

export interface CompileOptions {
  /**
   * The chain to compile for — a slug (`"base"`), a chain id (`8453`) or a canonical chain — whose
   * names the program's token symbols and namespace references resolve to. Defaults to the
   * document's `chainId`; a document without one needs it, and one with a `chainId` compiles for
   * that chain only.
   */
  readonly chain?: ChainRef;
}

/** Runtime argument values, by `argument` name. Each is a uint256. */
export type ArgumentValues = Readonly<Record<string, bigint | number | string>>;

export interface CompiledProgram {
  readonly bytecode: Uint8Array;
  /**
   * The SauceScript the actions lowered to, with every name as written — `USDC`,
   * `UniswapV3.Factory.getPool(...)` — which the compile resolved on its chain.
   */
  readonly source: string;
  /** The ABI bindings `source` calls through (`IErc20`, `IAaveV3Pool`), handed to its compile. */
  readonly contracts: ActionContracts;
  /** The `argument` names, in the order `main` takes them. Empty when there are none. */
  readonly parameters: readonly string[];
  readonly entryEncoding: "abi-v1";
  /** `bytecode` followed by the encoded arguments — the `program` a Pot's `cook(engine, program)` takes. */
  payload(values?: ArgumentValues): Uint8Array;
  /**
   * Where argument `name`'s 32-byte big-endian value starts in `payload(...)`, for splicing a
   * number into a payload built earlier.
   */
  argumentOffset(name: string): number;
}

/**
 * An action program checked for one chain and lowered: what `programSource` and `compileProgram`
 * start from.
 */
export interface LoweredProgram {
  readonly chain: CanonicalChain;
  /** The program as parsed: canonical, every name as written. */
  readonly program: ActionProgram;
  readonly lowered: Lowered;
}

/**
 * The chain a document compiles for: `given`, else its own `chainId`. A document with a `chainId`
 * compiles for that chain alone — its addresses are that chain's.
 */
function targetChain(
  documentChain: number | undefined,
  given: ChainRef | undefined,
): CanonicalChain {
  const ref = given ?? documentChain;
  if (ref === undefined) {
    throw new Error(
      "the action program has no `chainId`, so say which chain to compile it for: pass `chain` " +
        '(a slug such as "base", or a chain id). A document that names its tokens and ' +
        "contracts compiles for any chain where they exist.",
    );
  }
  const chain = resolveChain(ref);
  if (chain === undefined) {
    throw new Error(
      `unknown chain ${JSON.stringify(String(ref))}: the program's names resolve against one of ` +
        'the SDK\'s canonical chains (a slug such as "base", or its chain id)',
    );
  }
  if (chain.kind !== "evm") {
    throw new Error(`action programs run on EVM chains; ${chain.slug} is ${chain.kind}`);
  }
  if (documentChain !== undefined && chain.id !== documentChain) {
    throw new ProgramError([
      {
        path: "chainId",
        message:
          `the program is written for chain ${documentChain}, not ${chainLabel(chain)}: its ` +
          "addresses are that chain's. Leave `chainId` out to compile it for other chains — " +
          "with every token and contract named, it compiles for any chain that has them",
      },
    ]);
  }

  return chain;
}

/**
 * Parses `program`, checks every name it uses — and the rules its resolved addresses must keep
 * (no swap of a token for itself, a chain's native-coin rules) — on the chain it compiles for,
 * finds each Across deposit's destination token, and lowers it. Throws a `ProgramError` listing
 * every problem with its path.
 */
export function lowerProgram(program: ActionProgram, chain?: ChainRef): LoweredProgram {
  const parsed = parseProgram(program);
  const target = targetChain(parsed.chainId, chain);
  const { resolved, issues } = resolveNames(parsed.actions, target);
  issues.push(...wrappedNativeIssues(parsed.actions, target));
  const across = acrossOutputTokens(parsed.actions, resolved, target);
  if (issues.length === 0) issues.push(...programIssues(resolved, target.id), ...across.issues);
  if (issues.length > 0) throw new ProgramError(issues, target);

  return { chain: target, program: parsed, lowered: lowerActions(across.actions) };
}

/** An action program as the SauceScript it lowers to on one chain: what `sauce actions` prints. */
export interface ProgramSource {
  readonly chain: CanonicalChain;
  /** The document as parsed: canonical, every name as written. */
  readonly program: ActionProgram;
  /** A standalone program, `main`'s parameters typed — the source `compileProgram` compiles. */
  readonly source: string;
  /** The ABI bindings `source` calls through, which its compile takes as `contracts`. */
  readonly contracts: ActionContracts;
  /** The `argument` names, in the order `main` takes them. */
  readonly parameters: readonly string[];
}

/**
 * The SauceScript an action program lowers to for `chain` (else its `chainId`), checked there but
 * not compiled: with `contracts`, `routes.compileSauceProgram(chain, source, { contracts })`
 * compiles it to the bytes `compileProgram` returns. The `sauce` command's `actions` reads this,
 * and hands the source to the compile and cook every other program goes through.
 */
export function programSource(program: ActionProgram, chain?: ChainRef): ProgramSource {
  const lowered = lowerProgram(program, chain);

  return {
    chain: lowered.chain,
    program: lowered.program,
    source: renderProgram(lowered.lowered),
    contracts: lowered.lowered.contracts,
    parameters: lowered.lowered.parameters,
  };
}

/**
 * Compiles an action program standalone, for `options.chain` or its own `chainId`. Its `argument`
 * actions become runtime arguments.
 */
export function compileProgram(
  program: ActionProgram,
  options: CompileOptions = {},
): CompiledProgram {
  const { chain, lowered } = lowerProgram(program, options.chain);

  return compiled(renderProgram(lowered), lowered.contracts, lowered.parameters, chain);
}

/**
 * Compiles generated source into a `CompiledProgram`: for `chain` with its names, through the SDK's
 * program compile, or — a split swap with no chain, whose source holds only addresses — directly.
 */
export function compiled(
  source: string,
  contracts: ActionContracts,
  parameters: readonly string[],
  chain?: CanonicalChain,
): CompiledProgram {
  const result =
    chain === undefined
      ? compileEvm(source, contracts)
      : compileSauceProgram(chain, source, { contracts });
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

  const encodeArguments = (values?: ArgumentValues): Uint8Array => {
    const args = positional(values);
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
    contracts,
    parameters,
    entryEncoding: result.entryEncoding,
    payload: (values) => concatBytes([bytecode, encodeArguments(values)]),
    argumentOffset(name) {
      const index = parameters.indexOf(name);
      if (index < 0) throw new Error(`no argument named '${name}'`);
      return bytecode.length + 32 * index;
    },
  };
}

/**
 * Cross-chain intent DSL — chain-global surface: `Base(sauce, options).reward(rewardArg)` (and,
 * identically, `Base.route(sauce, options).reward(rewardArg)`).
 *
 * `openRoute` is what every chain global's callable/`.route` forwards to (see `builder.ts`). It
 * compiles `sauce` for the DESTINATION chain (the chain the global names) and slots the result into
 * `route.calls`, reusing the EXISTING V2 schema/assembly/encode/hash machinery entirely unchanged:
 * `assembleIntent` (`intent.ts`) builds the `Intent`, `hashIntent`/`encodeRouteEvm`/`encodeRouteSvm`/
 * `encodeRewardEvm`/`encodeRewardSvm` (`encode.ts`) hash/encode it. The only NEW logic in this file
 * is the fluent surface itself plus the destination-execution seam (`compileSauceRoute`,
 * `sauce-route.ts`) and the CREATE2 vault predictor (`vault.ts`).
 *
 * SCOPE (this pass): depth-1 only — one `route().reward()` produces exactly one `Intent`.
 * `intents()` already returns a head-first array so a later nesting stage can grow it to more than
 * one element without changing this method's shape.
 */
import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { encodeRewardEvm, encodeRewardSvm, encodeRouteEvm, encodeRouteSvm, hashIntent } from "./encode.js";
import type { IntentHashes } from "./encode.js";
import { assembleIntent } from "./intent.js";
import {
  compileSauceRoute,
  type CompiledSauceRoute,
  type SauceCompileOptions,
  type SauceEvmExecutionInput,
  type SauceSvmExecutionInput,
} from "./sauce-route.js";
import type { CompileResult } from "@eco-incorp/sauce-compiler";
import { predictVaultAddress, type VaultConfig } from "./vault.js";
import type {
  AddressInput,
  CallInput,
  Hex,
  Intent,
  RewardInput,
  TokenAmountInput,
} from "./types.js";

/**
 * A route body: a complete `function main(){...}` program, a bare body (see
 * `sauce-route.ts#wrapSauceBody`), or a closure (see `closure.ts#sauceBodyToSource`) whose
 * `Function.prototype.toString()` is extracted as SauceScript source. Closures capture nothing by
 * construction — a free identifier must come from `IntentOptions.defines` (or chain-scoped ambient
 * defines) or the compile fails closed with `undefined variable: X`.
 */
export type SauceBody = string | (() => unknown);

/** Everything a route needs beyond the Sauce program body itself. */
export interface IntentOptions {
  /** The destination-chain execution seam — required, unless `.pot` (EVM shorthand) is supplied instead. */
  execution?: SauceEvmExecutionInput | SauceSvmExecutionInput;
  /** EVM shorthand for `execution: { pot }` — mutually redundant with `execution`, never both meaningfully differ. */
  pot?: AddressInput;
  compile?: SauceCompileOptions;
  /** Scalar ambient defines threaded into `compile()`, underneath the chain-scoped ones (see `ambient.ts`). */
  defines?: Record<string, bigint | boolean | number>;
  salt?: Hex;
  /** The ROUTE's own deadline — required. */
  deadline: bigint | number | string;
  /** The ROUTE's Portal contract — required. */
  portal: AddressInput;
  nativeAmount?: bigint | number | string;
  tokens?: readonly TokenAmountInput[];
  /** Calls spliced BEFORE the compiled Sauce call, in order. */
  precalls?: readonly CallInput[];
  /** Reward fallbacks — used only when `.reward(rewardArg)`'s own argument doesn't supply them. */
  source?: ChainRef;
  creator?: AddressInput;
  prover?: AddressInput;
  rewardDeadline?: bigint | number | string;
}

/** The object form of a reward argument — every field optional, since a missing one falls back to
 *  the matching `IntentOptions` field (and a STILL-missing required field throws, naming exactly
 *  which one). */
export interface SauceRewardSpec {
  readonly source?: ChainRef;
  readonly deadline?: bigint | number | string;
  readonly creator?: AddressInput;
  readonly prover?: AddressInput;
  readonly nativeAmount?: bigint | number | string;
  readonly tokens?: readonly TokenAmountInput[];
}

/**
 * `.reward(...)`'s argument: the full object form, a bare `bigint` (the single unambiguous
 * reading — NATIVE amount only; a token reward must name its token), or a bare token-amount array
 * (`reward.tokens`).
 */
export type RewardArg = SauceRewardSpec | bigint | readonly TokenAmountInput[];

export interface BuiltIntent {
  readonly intent: Intent;
  readonly destination: CanonicalChain;
  readonly source: CanonicalChain;
  /** The destination-chain `CompileResult` this intent's route call was compiled from. */
  readonly compiled: CompileResult;
  /** The head intent. Until nesting lands, this only ever has one. */
  root(): Intent;
  /** Head-first. Length 1 in this stage — see the module doc. */
  intents(): readonly Intent[];
  hash(): IntentHashes;
  encodeEVM(): { readonly route: Hex; readonly reward: Hex };
  encodeSVM(): { readonly route: Hex; readonly reward: Hex };
  vault(config: VaultConfig): Hex;
}

export interface PendingSauceRoute {
  reward(rewardArg: RewardArg): BuiltIntent;
}

function missingField(field: string, where: string): never {
  throw new Error(
    `openRoute: '${field}' is required — supply it ${where}`,
  );
}

function isTokenAmountArray(value: RewardArg): value is readonly TokenAmountInput[] {
  return Array.isArray(value);
}

/** Resolves `.reward(rewardArg)`'s argument against `options`' own fallback fields, into a
 *  fully-formed `(source, RewardInput)` pair -- or throws, naming exactly which required field
 *  (`source`/`creator`/`prover`/`deadline`) is missing from BOTH the reward argument and `options`. */
function resolveReward(
  rewardArg: RewardArg,
  options: IntentOptions | undefined,
): { readonly source: CanonicalChain; readonly reward: RewardInput } {
  const spec: SauceRewardSpec =
    typeof rewardArg === "bigint"
      ? { nativeAmount: rewardArg }
      : isTokenAmountArray(rewardArg)
        ? { tokens: rewardArg }
        : rewardArg;

  const sourceRef = spec.source ?? options?.source;
  if (sourceRef === undefined) {
    missingField("source", "as `reward.source` or `IntentOptions.source`");
  }
  const source = requireChain(sourceRef);

  const deadline = spec.deadline ?? options?.rewardDeadline ?? options?.deadline;
  if (deadline === undefined) {
    missingField("deadline", "as `reward.deadline`, `IntentOptions.rewardDeadline`, or `IntentOptions.deadline`");
  }
  const creator = spec.creator ?? options?.creator;
  if (creator === undefined) {
    missingField("creator", "as `reward.creator` or `IntentOptions.creator`");
  }
  const prover = spec.prover ?? options?.prover;
  if (prover === undefined) {
    missingField("prover", "as `reward.prover` or `IntentOptions.prover`");
  }

  return {
    source,
    reward: {
      deadline,
      creator,
      prover,
      nativeAmount: spec.nativeAmount,
      tokens: spec.tokens,
    },
  };
}

function makeBuiltIntent(
  intent: Intent,
  destination: CanonicalChain,
  source: CanonicalChain,
  compiled: CompileResult,
): BuiltIntent {
  return {
    intent,
    destination,
    source,
    compiled,
    root(): Intent {
      return intent;
    },
    intents(): readonly Intent[] {
      return [intent];
    },
    hash(): IntentHashes {
      return hashIntent(intent);
    },
    encodeEVM() {
      return { route: encodeRouteEvm(intent.route), reward: encodeRewardEvm(intent.reward) };
    },
    encodeSVM() {
      return { route: encodeRouteSvm(intent.route), reward: encodeRewardSvm(intent.reward) };
    },
    vault(config: VaultConfig): Hex {
      return predictVaultAddress(hashIntent(intent).intentHash, config);
    },
  };
}

/**
 * Opens a route on `chain` (the DESTINATION) — what every chain global's callable AND `.route`
 * forward to, so `Base(sauce, opts)` and `Base.route(sauce, opts)` are behaviorally identical by
 * construction (both call this exact function).
 */
export function openRoute(chain: ChainRef, sauce: SauceBody, options?: IntentOptions): PendingSauceRoute {
  const destination = requireChain(chain);

  if (options === undefined) {
    missingField("execution/pot, deadline, portal", "via `IntentOptions` (the second argument)");
  }
  if (options.deadline === undefined) {
    missingField("deadline", "as `IntentOptions.deadline`");
  }
  if (options.portal === undefined) {
    missingField("portal", "as `IntentOptions.portal`");
  }
  const execution = options.execution ?? (options.pot !== undefined ? { pot: options.pot } : undefined);
  if (execution === undefined) {
    missingField("execution", "as `IntentOptions.execution` or the EVM shorthand `IntentOptions.pot`");
  }

  if (typeof sauce !== "string") {
    throw new Error(
      "openRoute: closure route bodies are not supported yet — pass a string (see sauce-route.ts#wrapSauceBody)",
    );
  }

  const compiledRoute: CompiledSauceRoute = compileSauceRoute(destination, sauce, execution, options.compile);
  const calls: CallInput[] = [...(options.precalls ?? []), ...compiledRoute.calls];

  return {
    reward(rewardArg: RewardArg): BuiltIntent {
      const { source, reward } = resolveReward(rewardArg, options);
      const intent = assembleIntent(
        source,
        destination,
        {
          salt: options.salt,
          deadline: options.deadline,
          portal: options.portal,
          nativeAmount: options.nativeAmount,
          tokens: options.tokens,
          calls,
        },
        reward,
      );
      return makeBuiltIntent(intent, destination, source, compiledRoute.compiled);
    },
  };
}

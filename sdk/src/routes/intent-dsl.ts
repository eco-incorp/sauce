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
import { chainAmbient, chainDefines } from "./ambient.js";
import { isSauceClosure, sauceBodyToSource, type SauceBody } from "./closure.js";
import {
  encodeRewardEvm,
  encodeRewardSvm,
  encodeRouteEvm,
  encodeRouteSvm,
  hashIntent,
} from "./encode.js";
import type { IntentHashes } from "./encode.js";
import { assembleIntent } from "./intent.js";
import {
  assertNestingInvariants,
  nestedChildCalls,
  nestedTransferProgram,
  type ChildVaultResolution,
  type NestVia,
  type TransferNestEntry,
} from "./nest.js";
import { normalizeRoute, toBigInt } from "./normalize.js";
import {
  approvalTxs,
  fundTx,
  intentHashCall,
  intentVaultAddressCall,
  isIntentFundedCall,
  publishAndFundTx,
  publishTx,
  type PortalReadCall,
  type PortalTarget,
  type PortalTx,
} from "./portal.js";
import {
  compileSauceRoute,
  type CompiledSauceRoute,
  type SauceCompileOptions,
  type SauceEvmExecutionInput,
  type SauceSvmExecutionInput,
} from "./sauce-route.js";
import type { CompileResult } from "./compile-types.js";
import { predictVaultAddress, type VaultConfig } from "./vault.js";
import type {
  AddressInput,
  CallInput,
  Hex,
  Intent,
  RewardInput,
  Route,
  TokenAmountInput,
} from "./types.js";

export type { NestVia };

/**
 * A route body: a complete `function main(){...}` program, a bare body (see
 * `sauce-route.ts#wrapSauceBody`), or a closure (see `closure.ts#sauceBodyToSource`) whose
 * `Function.prototype.toString()` is extracted as SauceScript source. Closures capture nothing by
 * construction — a free identifier must come from `IntentOptions.defines` (or chain-scoped ambient
 * defines) or the compile fails closed with "`X` is not a declared variable".
 */
export type { SauceBody };

/** Route and reward options shared by the EVM and SVM execution forms. */
interface IntentOptionsCommon {
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
  /** Caller-supplied token symbol -> address map, folded into the chain-scoped ambient defines
   *  (see `ambient.ts`) -- distinct from `.tokens` above (route/reward TOKEN AMOUNTS). */
  tokenDefines?: Readonly<Record<string, AddressInput>>;
  /** The SOURCE-chain Portal — where this intent is PUBLISHED. Distinct from `portal` above, which
   *  is the DESTINATION-chain Portal that lands in `route.portal`. Used as the default target for
   *  every submission/read helper on `BuiltIntent` below. */
  sourcePortal?: AddressInput;
}

/**
 * Everything a route needs beyond the Sauce program body itself. Supply an explicit destination
 * execution, or both `pot` and `engine` as the EVM shorthand. When `execution` is supplied it takes
 * precedence over any redundant shorthand fields, matching `openRoute`'s runtime behavior.
 */
export type IntentOptions = IntentOptionsCommon &
  (
    | {
        /** The destination-chain execution seam; takes precedence over the EVM shorthand. */
        execution: SauceEvmExecutionInput | SauceSvmExecutionInput;
        pot?: AddressInput;
        engine?: AddressInput;
      }
    | {
        execution?: undefined;
        /** EVM shorthand for `execution: { pot, engine }`. */
        pot: AddressInput;
        /** The interpreter the cook runs on. Never defaulted; see `SauceEvmExecutionInput.engine`. */
        engine: AddressInput;
      }
  );

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
  /** Direct children attached via `.nest()`, in the order they were nested. Empty for a depth-1
   *  intent (the default, unaffected by nesting at all). */
  readonly children: readonly BuiltIntent[];
  /** The head intent — this one. Forward-compatible name for `intent`. */
  root(): Intent;
  /** PRE-ORDER DFS over this intent and every descendant, head first. Length 1 until `.nest()` is
   *  used; a depth-2 cascade (head -> child -> grandchild) has length 3. */
  intents(): readonly Intent[];
  hash(): IntentHashes;
  encodeEVM(): { readonly route: Hex; readonly reward: Hex };
  encodeSVM(): { readonly route: Hex; readonly reward: Hex };

  publishCalldata(target?: Partial<PortalTarget>): PortalTx;
  publishAndFundCalldata(allowPartial: boolean, target?: Partial<PortalTarget>): PortalTx;
  fundCalldata(allowPartial: boolean, target?: Partial<PortalTarget>): PortalTx;
  /** HEAD reward tokens only — a child is funded by its parent's execution, not the user; see
   *  `nest.ts`/`intent-dsl.ts`'s `.nest()` once nesting lands. */
  approvals(target?: Partial<PortalTarget>): readonly PortalTx[];

  /** PRIMARY vault path: the on-chain `Portal.intentVaultAddress` read-call. The caller performs the
   *  `eth_call`; this module never does RPC. */
  vaultCall(target?: Partial<PortalTarget>): PortalReadCall<Hex>;
  /** OPTION: the offline CREATE2 predictor — zero RPC, needs `config.vaultInitCodeHash`. */
  predictVault(config: VaultConfig): Hex;
  /** @deprecated alias of `predictVault`, kept so the already-landed, unit-tested surface keeps working. */
  vault(config: VaultConfig): Hex;

  /** Cross-check helpers: our off-chain `hash()` vs the chain's own, and funded status. */
  hashCall(target?: Partial<PortalTarget>): PortalReadCall<IntentHashes>;
  fundedCall(target?: Partial<PortalTarget>): PortalReadCall<boolean>;
}

/** `.nest(childOrThunk, opts?)`'s first argument: either an already-built child `BuiltIntent`
 *  (checked against `child.source.id === parent.destination.id`, so a mismatched leg is rejected
 *  rather than silently accepted), or — the documented PREFERRED form — a thunk receiving the
 *  parent's own destination chain (which IS the child's source, by construction, so there is
 *  nothing to get wrong). */
export type NestChildOrThunk = BuiltIntent | ((parentChain: CanonicalChain) => BuiltIntent);

/** `vaultConfig`'s shape — like `VaultConfig` but `portal` is optional (defaults to the resolved
 *  nest `portal`, per `ChildVaultResolution`'s "predicted" rung). */
export interface NestVaultConfigInput {
  readonly vaultInitCodeHash: Hex;
  readonly portal?: AddressInput;
  readonly prefix?: Hex;
}

export interface NestOptions {
  /**
   * The nesting mechanism. **DSL default: `"transfer"`** (2026-08-11 directive) — deliberately the
   * OPPOSITE of `nest.ts`'s own pure-module default (`"publishAndFund"`, kept so every already-landed
   * caller of that module keeps its exact meaning). `"transfer"`: the parent's route transfers a
   * balance-capped amount to the (fully static) child's vault, auto-scaling with static hashes and
   * needing no on-chain publication. `"publishAndFund"`: the opt-in, kept reachable verbatim — choose
   * it for public on-chain discovery (solvers already index `IntentPublished`) and exact-amount
   * Portal-pulled funding.
   */
  via?: NestVia;
  /** Where the child's calls (the transfer program's `cook()`, or the spliced `approve`s +
   *  `publishAndFund`) sit relative to the compiled Sauce call. Defaults to `"after"` — the parent's
   *  own program runs first (load-bearing for `via: "transfer"`: only an "after" transfer sees what
   *  the body earned). */
  position?: "before" | "after";
  /** Overrides the Portal the child's calls/vault-read are issued against. Defaults to this route's
   *  own `IntentOptions.portal` (the parent's own `route.portal`) — see `nest.ts`'s module doc for why
   *  that default is the structurally correct one, not just a convenience. */
  portal?: AddressInput;

  // -- publishAndFund-only (throws under via: "transfer") -----------------------------------------
  /** Passed through to the spliced `publishAndFund` call. Defaults to `false` — a partially funded
   *  child is a stalled cascade. */
  allowPartial?: boolean;
  /** Opts this child out of `assertNestingInvariants`'s funding-coverage check (invariant 5) — the
   *  legitimate case where the parent's own Sauce program earns and forwards the child's reward.
   *  Meaningless under `via: "transfer"` (invariant 5 is unconditionally dropped there). */
  fundedByBody?: boolean;

  // -- transfer-only (throws under via: "publishAndFund") ------------------------------------------
  /** Rung C: a caller-verified vault address (typically from `child.vaultCall()`'s own `eth_call`).
   *  Zero config, zero leak, the recommended production rung. Precedence over `vaultConfig`/the
   *  runtime default. */
  vault?: AddressInput;
  /** Rung B: bakes `predictVaultAddress` as a constant (`portal` defaults to this nest's own
   *  `portal`). Leanest and the only rung keeping the child off-chain — but a wrong
   *  `vaultInitCodeHash` sends funds to a dead address irrecoverably; cross-check with
   *  `child.vaultCall()` once before trusting it. */
  vaultConfig?: NestVaultConfigInput;
  /** Caps the transferred amount at the child's own declared reward amount. Default `true`. */
  clamp?: boolean;
  /** Reverts the parent's whole fulfillment when the Pot's balance is already short of the cap,
   *  rather than quietly stalling the child. Default `false`. */
  requireCap?: boolean;
  /** `"skip"` omits the native leg even when the child declares `reward.nativeAmount > 0`. Default
   *  `"balance"`. */
  native?: "balance" | "skip";
  /** Adds `child.reward.nativeAmount` to the transfer cook's fee, so solver-delivered
   *  native funding (via this route's own `route.nativeAmount`) reaches the Pot before the transfer
   *  reads `ctx.selfBalance()`. Default `false`. Re-enables a NATIVE-only coverage check (T5): the sum
   *  of every opted-in child's `nativeAmount` must not exceed this route's own `route.nativeAmount`. */
  fundNativeFromRoute?: boolean;
  /** Current Kitchen fee in wei, paid once per merged transfer cook. Defaults to zero; read the
   *  destination Kitchen's executionFee before building for a priced deployment. */
  executionFee?: bigint | number | string;
  /** Overrides the Pot the transfer `cook()` executes on. Defaults to this route's own EVM
   *  `execution.pot` (T3: required for `via: "transfer"` — a Solana/SVM destination has no Pot). */
  pot?: AddressInput;
  /** Overrides the interpreter that Pot's cook runs on. Defaults to this route's own
   *  `execution.engine`. */
  engine?: AddressInput;
  /** Compile options for the generated transfer program (merged with `baseDirs`/`target: 'v12'`,
   *  which this module always supplies). */
  compile?: SauceCompileOptions;
}

export interface PendingSauceRoute {
  reward(rewardArg: RewardArg): BuiltIntent;
  /**
   * Attaches a STATIC child cascade leg. At `.reward()` time: under the **default** `via:
   * "transfer"`, a per-child `balanceOf`/clamp/transfer Sauce program (merged, in `.nest()` order,
   * with every other same-position `"transfer"` child) is compiled and slotted as one extra `cook()`
   * call; under the opt-in `via: "publishAndFund"`, the child's `approve`(s) + `publishAndFund` are
   * spliced in verbatim, exactly as before this mechanism existed. Either way the calls sit before or
   * after the compiled Sauce call per `opts.position`, and `assertNestingInvariants` runs over every
   * nested child. Chainable and order-preserving — call `.nest()` multiple times to attach multiple
   * children.
   */
  nest(childOrThunk: NestChildOrThunk, opts?: NestOptions): PendingSauceRoute;
}

function missingField(field: string, where: string): never {
  throw new Error(`openRoute: '${field}' is required — supply it ${where}`);
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
    missingField(
      "deadline",
      "as `reward.deadline`, `IntentOptions.rewardDeadline`, or `IntentOptions.deadline`",
    );
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

function missingSourcePortal(): never {
  throw new Error(
    "BuiltIntent: no Portal target — supply it as the call's own `target.portal` or as " +
      "`IntentOptions.sourcePortal` when building the intent",
  );
}

function resolveTarget(
  target: Partial<PortalTarget> | undefined,
  sourcePortal: AddressInput | undefined,
): PortalTarget {
  const portal = target?.portal ?? sourcePortal;
  if (portal === undefined) missingSourcePortal();
  return { portal };
}

function makeBuiltIntent(
  intent: Intent,
  destination: CanonicalChain,
  source: CanonicalChain,
  compiled: CompileResult,
  sourcePortal: AddressInput | undefined,
  children: readonly BuiltIntent[] = [],
): BuiltIntent {
  const target = (t: Partial<PortalTarget> | undefined) => resolveTarget(t, sourcePortal);

  return {
    intent,
    destination,
    source,
    compiled,
    children,
    root(): Intent {
      return intent;
    },
    intents(): readonly Intent[] {
      return [intent, ...children.flatMap((c) => c.intents())];
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
    publishCalldata(t) {
      return publishTx(intent, target(t));
    },
    publishAndFundCalldata(allowPartial, t) {
      return publishAndFundTx(intent, allowPartial, target(t));
    },
    fundCalldata(allowPartial, t) {
      return fundTx(intent, allowPartial, target(t));
    },
    approvals(t) {
      return approvalTxs(intent, target(t));
    },
    vaultCall(t) {
      return intentVaultAddressCall(intent, target(t));
    },
    predictVault(config: VaultConfig): Hex {
      return predictVaultAddress(hashIntent(intent).intentHash, config);
    },
    vault(config: VaultConfig): Hex {
      return predictVaultAddress(hashIntent(intent).intentHash, config);
    },
    hashCall(t) {
      return intentHashCall(intent, target(t));
    },
    fundedCall(t) {
      return isIntentFundedCall(intent, target(t));
    },
  };
}

/**
 * Opens a route on `chain` (the DESTINATION) — what every chain global's callable AND `.route`
 * forward to, so `Base(sauce, opts)` and `Base.route(sauce, opts)` are behaviorally identical by
 * construction (both call this exact function).
 */
export function openRoute(
  chain: ChainRef,
  sauce: SauceBody,
  options?: IntentOptions,
): PendingSauceRoute {
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
  if (
    options.execution === undefined &&
    options.pot !== undefined &&
    options.engine === undefined
  ) {
    missingField("engine", "alongside the `IntentOptions.pot` shorthand");
  }
  const execution =
    options.execution ??
    (options.pot !== undefined && options.engine !== undefined
      ? { pot: options.pot, engine: options.engine }
      : undefined);
  if (execution === undefined) {
    missingField(
      "execution",
      "as `IntentOptions.execution` or the EVM shorthand `IntentOptions.pot`",
    );
  }

  const closure = isSauceClosure(sauce);
  const sauceSource = closure ? sauceBodyToSource(sauce) : sauce;

  // Chain-scoped ambient defines (chainId, protocol/contract addresses, caller token symbols) sit
  // UNDERNEATH the caller's own IntentOptions.defines, which sits underneath the most-specific
  // IntentOptions.compile.defines -- caller always wins on a key collision; a user-declared local
  // inside the body wins over all of this via the compiler's own getConstant/getVar precedence.
  const ambientDefines = chainDefines(destination, { tokens: options.tokenDefines });
  const mergedDefines = { ...ambientDefines, ...options.defines, ...options.compile?.defines };

  // P7 — the ambient-MODULE half of the chain bundle (`ambientDefines` above is the scalar half).
  // `chainAmbient(destination)` is the plugin's chain-scoped ambient module list (`["@sauce/token"]`
  // by default, see `ambient.ts#chainAmbient`/`plugin/index.ts`'s own notes); merged with any
  // caller-supplied `options.compile.ambient` (deduped -- either side may legitimately name the
  // same module).
  const mergedAmbient = Array.from(
    new Set([...chainAmbient(destination), ...(options.compile?.ambient ?? [])]),
  );
  const compileOptions: SauceCompileOptions = {
    ...options.compile,
    defines: mergedDefines,
    tokens: options.compile?.tokens ?? options.tokenDefines,
    ambient: mergedAmbient.length > 0 ? mergedAmbient : options.compile?.ambient,
  };

  let compiledRoute: CompiledSauceRoute;
  try {
    compiledRoute = compileSauceRoute(destination, sauceSource, execution, compileOptions);
  } catch (err) {
    // The compiler reports a free identifier as "`X` is not a declared variable", inside a larger
    // rustc-style diagnostic — so match the sentence rather than a message prefix.
    const undeclared =
      err instanceof Error ? /`([^`]+)` is not a declared variable/.exec(err.message) : null;
    if (closure && undeclared !== null) {
      const name = undeclared[1]!;
      throw new Error(
        `openRoute: closure route body references '${name}', which is not defined — a closure ` +
          `captures nothing by construction; supply '${name}' via IntentOptions.defines (or a chain-scoped ` +
          `ambient define) instead.`,
        // Keep the compiler's own diagnostic reachable: this message names the fix, the cause
        // carries the full rustc-style report the regex above only matched one sentence of.
        { cause: err },
      );
    }
    throw err;
  }

  interface NestEntry {
    readonly built: BuiltIntent;
    readonly via: NestVia;
    readonly position: "before" | "after";
    readonly portal: AddressInput;
    // publishAndFund-only:
    readonly allowPartial: boolean;
    readonly fundedByBody: boolean;
    // transfer-only:
    readonly vault?: AddressInput;
    readonly vaultConfig?: NestVaultConfigInput;
    readonly clamp: boolean;
    readonly requireCap: boolean;
    readonly native: "balance" | "skip";
    readonly fundNativeFromRoute: boolean;
    readonly executionFee: bigint;
    readonly pot?: AddressInput;
    readonly engine?: AddressInput;
    readonly compile?: SauceCompileOptions;
  }
  const nestedEntries: NestEntry[] = [];

  const TRANSFER_ONLY_KEYS: readonly (keyof NestOptions)[] = [
    "vault",
    "vaultConfig",
    "clamp",
    "requireCap",
    "native",
    "fundNativeFromRoute",
    "executionFee",
    "pot",
    "engine",
    "compile",
  ];
  const PUBLISH_ONLY_KEYS: readonly (keyof NestOptions)[] = ["allowPartial", "fundedByBody"];

  function assertNestOptionMode(via: NestVia, opts: NestOptions | undefined): void {
    if (opts === undefined) return;
    const otherVia: NestVia = via === "transfer" ? "publishAndFund" : "transfer";
    const offendingKeys = via === "transfer" ? PUBLISH_ONLY_KEYS : TRANSFER_ONLY_KEYS;
    for (const key of offendingKeys) {
      if (opts[key] !== undefined) {
        throw new Error(
          `openRoute: .nest() option '${key}' is only valid with via: "${otherVia}" — it is meaningless ` +
            `under via: "${via}" (mode-mismatched options throw rather than being silently ignored).`,
        );
      }
    }
  }

  function evmPotOf(
    exec: SauceEvmExecutionInput | SauceSvmExecutionInput | undefined,
  ): AddressInput | undefined {
    return exec !== undefined && "pot" in exec ? exec.pot : undefined;
  }

  function evmEngineOf(
    exec: SauceEvmExecutionInput | SauceSvmExecutionInput | undefined,
  ): AddressInput | undefined {
    return exec !== undefined && "engine" in exec ? exec.engine : undefined;
  }

  const pending: PendingSauceRoute = {
    nest(childOrThunk: NestChildOrThunk, opts?: NestOptions): PendingSauceRoute {
      const isThunk = typeof childOrThunk === "function";
      const built = isThunk ? childOrThunk(destination) : childOrThunk;
      if (!isThunk && built.source.id !== destination.id) {
        throw new Error(
          `openRoute: .nest() child's source ('${built.source.slug}') does not match this route's ` +
            `destination ('${destination.slug}') — a child's source chain is always its parent's ` +
            `destination (execution) chain. Prefer the thunk form (\`.nest((on) => ...)\`), which cannot ` +
            `get this wrong.`,
        );
      }

      const via: NestVia = opts?.via ?? "transfer";
      assertNestOptionMode(via, opts);

      if (via === "transfer" && evmPotOf(execution) === undefined && opts?.pot === undefined) {
        throw new Error(
          `openRoute: .nest() via: "transfer" requires an EVM Pot execution (T3) — this route's own ` +
            `IntentOptions.execution/pot must name a Pot (a Solana/SVM destination has none), or pass ` +
            `NestOptions.pot explicitly.`,
        );
      }

      nestedEntries.push({
        built,
        via,
        position: opts?.position ?? "after",
        portal: opts?.portal ?? options.portal,
        allowPartial: opts?.allowPartial ?? false,
        fundedByBody: opts?.fundedByBody ?? false,
        vault: opts?.vault,
        vaultConfig: opts?.vaultConfig,
        clamp: opts?.clamp ?? true,
        requireCap: opts?.requireCap ?? false,
        native: opts?.native ?? "balance",
        fundNativeFromRoute: opts?.fundNativeFromRoute ?? false,
        executionFee: toBigInt(opts?.executionFee ?? 0n),
        pot: opts?.pot,
        engine: opts?.engine,
        compile: opts?.compile,
      });
      return pending;
    },
    reward(rewardArg: RewardArg): BuiltIntent {
      const { source, reward } = resolveReward(rewardArg, options);

      let parentRouteForInvariants: Route | undefined;
      if (nestedEntries.length > 0) {
        parentRouteForInvariants = normalizeRoute({
          deadline: options.deadline,
          portal: options.portal,
          nativeAmount: options.nativeAmount,
          tokens: options.tokens,
          calls: [],
        });
        assertNestingInvariants({
          parentChain: destination,
          parentRoute: parentRouteForInvariants,
          children: nestedEntries.map((e) => ({
            intent: e.built.intent,
            fundedByBody: e.fundedByBody,
            via: e.via,
          })),
        });

        // T5: a transfer child opting into `fundNativeFromRoute` re-enables a NATIVE-only coverage
        // check, since that native genuinely comes from this route's own `route.nativeAmount`.
        const fundNativeFromRouteTotal = nestedEntries
          .filter((e) => e.via === "transfer" && e.fundNativeFromRoute)
          .reduce((sum, e) => sum + e.built.intent.reward.nativeAmount, 0n);
        if (fundNativeFromRouteTotal > parentRouteForInvariants.nativeAmount) {
          throw new Error(
            `openRoute: .nest() children opted into fundNativeFromRoute total nativeAmount ` +
              `(${fundNativeFromRouteTotal}) exceeds this route's own route.nativeAmount ` +
              `(${parentRouteForInvariants.nativeAmount}) (T5) — the transfer cook's value cannot ` +
              `exceed what the solver delivered via route.nativeAmount.`,
          );
        }
      }

      /** Resolves a `NestEntry`'s vault-address rung, precedence explicit > predicted > runtime. */
      function resolveVaultResolution(e: NestEntry): ChildVaultResolution {
        if (e.vault !== undefined) return { mode: "explicit", vault: e.vault };
        if (e.vaultConfig !== undefined) {
          return {
            mode: "predicted",
            config: {
              vaultInitCodeHash: e.vaultConfig.vaultInitCodeHash,
              portal: e.vaultConfig.portal ?? e.portal,
              prefix: e.vaultConfig.prefix,
            },
          };
        }
        return { mode: "runtime", portal: e.portal };
      }

      /** Compiles every `via: "transfer"` entry in one position group into ONE merged `cook()`
       *  call (in `.nest()` order) — see `nest.ts#nestedTransferProgram`. */
      function buildTransferCall(transferEntries: readonly NestEntry[]): CallInput {
        const executionFee = transferEntries[0]!.executionFee;
        const defaultPot = evmPotOf(execution);
        const pot = transferEntries[0]!.pot ?? defaultPot;
        if (pot === undefined) {
          throw new Error(
            `openRoute: .nest() via: "transfer" requires an EVM Pot execution (T3) — this route's own ` +
              `IntentOptions.execution/pot must name a Pot, or pass NestOptions.pot explicitly.`,
          );
        }
        const defaultEngine = evmEngineOf(execution);
        const engine = transferEntries[0]!.engine ?? defaultEngine;
        if (engine === undefined) {
          throw new Error(
            `openRoute: .nest() via: "transfer" needs the interpreter the cook runs on — this route's ` +
              `own IntentOptions.execution/engine must name one, or pass NestOptions.engine explicitly.`,
          );
        }
        // Both are taken from entry 0 and both must therefore be UNANIMOUS across the group — the
        // merge produces one cook, so a second opinion cannot be honoured. Checking only the Pot
        // would silently run entry 1's bytecode on entry 0's interpreter, which is the one thing a
        // caller cannot see in the encoded call.
        for (const e of transferEntries) {
          if (e.executionFee !== executionFee) {
            throw new Error(
              "openRoute: .nest() transfer children merged into the same position group must " +
                "specify the same executionFee",
            );
          }
          const entryPot = e.pot ?? defaultPot;
          if (entryPot !== pot) {
            throw new Error(
              `openRoute: .nest() via: "transfer" children merged into the same position group must ` +
                `target the same Pot — got conflicting NestOptions.pot values ('${pot}' vs '${entryPot}').`,
            );
          }
          const entryEngine = e.engine ?? defaultEngine;
          if (entryEngine !== engine) {
            throw new Error(
              `openRoute: .nest() via: "transfer" children merged into the same position group must ` +
                `run on the same engine — got conflicting NestOptions.engine values ('${engine}' vs ` +
                `'${entryEngine}').`,
            );
          }
        }

        const entries: TransferNestEntry[] = transferEntries.map((e) => ({
          child: e.built.intent,
          opts: {
            vaultResolution: resolveVaultResolution(e),
            clamp: e.clamp,
            requireCap: e.requireCap,
            native: e.native,
          },
        }));

        const { source: transferSource, baseDirs } = nestedTransferProgram(entries);

        const nativeValue = transferEntries
          .filter((e) => e.fundNativeFromRoute)
          .reduce((sum, e) => sum + e.built.intent.reward.nativeAmount, executionFee);

        const perEntryCompile = transferEntries.map((e) => e.compile).find((c) => c !== undefined);
        const transferCompileOptions: SauceCompileOptions = {
          ...perEntryCompile,
          target: perEntryCompile?.target ?? "v12",
          baseDirs: [...(perEntryCompile?.baseDirs ?? []), ...baseDirs],
        };

        const compiledTransfer = compileSauceRoute(
          destination,
          transferSource,
          { pot, engine, value: nativeValue },
          transferCompileOptions,
        );
        return compiledTransfer.calls[0]!;
      }

      const childCalls = (position: "before" | "after"): CallInput[] => {
        const group = nestedEntries.filter((e) => e.position === position);
        const publishCalls = group
          .filter((e) => e.via === "publishAndFund")
          .flatMap((e) =>
            nestedChildCalls(e.built.intent, { portal: e.portal, allowPartial: e.allowPartial }),
          );
        const transferEntries = group.filter((e) => e.via === "transfer");
        const transferCalls =
          transferEntries.length > 0 ? [buildTransferCall(transferEntries)] : [];
        return [...publishCalls, ...transferCalls];
      };

      const calls: CallInput[] = [
        ...(options.precalls ?? []),
        ...childCalls("before"),
        ...compiledRoute.calls,
        ...childCalls("after"),
      ];

      if (nestedEntries.some((entry) => entry.executionFee > 0n)) {
        const fundedByBodyNative = nestedEntries
          .filter((entry) => entry.via === "publishAndFund" && entry.fundedByBody)
          .reduce((sum, entry) => sum + entry.built.intent.reward.nativeAmount, 0n);
        const requiredNative =
          calls.reduce((sum, call) => sum + toBigInt(call.value ?? 0n), 0n) - fundedByBodyNative;
        if (requiredNative > toBigInt(options.nativeAmount ?? 0n)) {
          throw new Error(
            `openRoute: route.nativeAmount must cover ${requiredNative} wei for its calls, ` +
              "including each cook's execution fee and forwarded child rewards",
          );
        }
      }

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
      return makeBuiltIntent(
        intent,
        destination,
        source,
        compiledRoute.compiled,
        options.sourcePortal,
        nestedEntries.map((e) => e.built),
      );
    },
  };
  return pending;
}

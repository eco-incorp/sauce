/**
 * Cross-chain intent DSL — S1: `intentOn(dest).route(spec).reward(spec)`.
 *
 * `Chain` here is the DESTINATION — the chain the Sauce program executes on — which is the opposite
 * of the existing `ChainOrigin.route(reward)` (`builder.ts`), where the chain a method is called on
 * is the SOURCE. That naming collision is deliberate and documented, not an oversight: stage 1 ships
 * this as its own, separately-named surface (`intentOn`) rather than overloading `chainAccessors`'
 * generated `Chain.route(...)` methods — flipping that global is the explicitly user-gated, breaking
 * stage S7 in the design doc, not something this file does.
 *
 * Reuses the EXISTING V2 schema/assembly/encode/hash machinery entirely unchanged:
 * `assembleIntent` (`intent.ts`) builds the `Intent`, `hashIntent`/`encodeRouteEvm`/`encodeRouteSvm`/
 * `encodeRewardEvm`/`encodeRewardSvm` (`encode.ts`) hash/encode it. The only NEW logic in this file
 * is the fluent surface itself plus the destination-execution seam (`compileSauceRoute`,
 * `sauce-route.ts`) and the CREATE2 vault predictor (`vault.ts`).
 *
 * SCOPE (stage 1): depth-1 only — one `route().reward()` produces exactly one `Intent`.
 * `intents()` already returns a head-first array so a later nesting stage (S5/S6) can grow it to
 * more than one element without changing this method's shape.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import type { ChainRef } from "./builder.js";
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

export interface SauceRouteSpec {
  /** A complete `function main(){...}` program, or a bare body — see `sauce-route.ts#wrapSauceBody`. */
  readonly sauce: string;
  readonly execution: SauceEvmExecutionInput | SauceSvmExecutionInput;
  readonly compile?: SauceCompileOptions;
  readonly salt?: Hex;
  readonly deadline: bigint | number | string;
  readonly portal: AddressInput;
  readonly nativeAmount?: bigint | number | string;
  readonly tokens?: readonly TokenAmountInput[];
  /** Calls spliced BEFORE the compiled Sauce call, in order. */
  readonly precalls?: readonly CallInput[];
}

/** `RewardInput` plus the SOURCE chain — the destination is fixed by `intentOn`, so the source is
 *  the one thing left for the reward to carry (and, once nesting lands in S5/S6, is exactly what a
 *  parent's own execution chain supplies to a nested child automatically). */
export interface SauceRewardSpec extends RewardInput {
  readonly source: ChainRef;
}

export interface BuiltIntent {
  readonly intent: Intent;
  readonly destination: CanonicalChain;
  readonly source: CanonicalChain;
  /** The destination-chain `CompileResult` this intent's route call was compiled from. */
  readonly compiled: CompileResult;
  /** The head intent. Until nesting (S5/S6) lands, `stage 1` only ever has one. */
  root(): Intent;
  /** Head-first. Length 1 in stage 1 — see the module doc. */
  intents(): readonly Intent[];
  hash(): IntentHashes;
  encodeEVM(): { readonly route: Hex; readonly reward: Hex };
  encodeSVM(): { readonly route: Hex; readonly reward: Hex };
  vault(config: VaultConfig): Hex;
}

export interface PendingSauceRoute {
  reward(spec: SauceRewardSpec): BuiltIntent;
}

export interface SauceIntentOrigin {
  readonly chain: CanonicalChain;
  route(spec: SauceRouteSpec): PendingSauceRoute;
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

/** Entry point: `intentOn(dest).route(spec).reward(spec)` -> `BuiltIntent`. */
export function intentOn(dest: ChainRef): SauceIntentOrigin {
  const destination = requireChain(dest);
  return {
    chain: destination,
    route(spec: SauceRouteSpec): PendingSauceRoute {
      const compiledRoute: CompiledSauceRoute = compileSauceRoute(
        destination,
        spec.sauce,
        spec.execution,
        spec.compile,
      );
      const calls: CallInput[] = [...(spec.precalls ?? []), ...compiledRoute.calls];
      return {
        reward(rewardSpec: SauceRewardSpec): BuiltIntent {
          const source = requireChain(rewardSpec.source);
          const intent = assembleIntent(
            source,
            destination,
            {
              salt: spec.salt,
              deadline: spec.deadline,
              portal: spec.portal,
              nativeAmount: spec.nativeAmount,
              tokens: spec.tokens,
              calls,
            },
            rewardSpec,
          );
          return makeBuiltIntent(intent, destination, source, compiledRoute.compiled);
        },
      };
    },
  };
}

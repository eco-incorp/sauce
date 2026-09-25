/**
 * Intent assembly — the ONE place that knows the current eco-routes schema's
 * field names. A future v3 reward-leg model swaps this file (and
 * `types.ts`); the builder (`builder.ts`) never references a field name
 * directly, only calls `assemble(...)`.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { emptyRoute, normalizeReward, normalizeRoute } from "./normalize.js";
import type { Intent, RewardInput, RouteInput } from "./types.js";

/**
 * Builds one `Intent` for a leg running from `source` to `destination`.
 * `route === undefined` means a TERMINAL close: the leg gets a synthesized
 * empty route (see `emptyRoute`) instead of a caller-supplied one.
 */
export function assembleIntent(
  source: CanonicalChain,
  destination: CanonicalChain,
  route: RouteInput | undefined,
  reward: RewardInput,
): Intent {
  const normalizedReward = normalizeReward(reward);
  return {
    destination: BigInt(destination.id),
    sourceChainId: BigInt(source.id),
    route: route === undefined ? emptyRoute(normalizedReward.deadline) : normalizeRoute(route),
    reward: normalizedReward,
  };
}

/**
 * Intent assembly — the ONE place that knows the current eco-routes schema's
 * field names. A future v3 reward-leg model swaps this file (and
 * `types.ts`); the builder (`builder.ts`) never references a field name
 * directly, only calls `assemble(...)`.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { chainById } from "../chains/canonical.js";
import { getChain, nativeErc20 } from "../chains/index.js";
import { emptyRoute, normalizeReward, normalizeRoute, toUniversalAddress } from "./normalize.js";
import type { AddressInput, Intent, Reward, RewardInput, RouteInput } from "./types.js";

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
  assertRewardAssetsDistinct(source.id, normalizedReward);
  return {
    destination: BigInt(destination.id),
    sourceChainId: BigInt(source.id),
    route: route === undefined ? emptyRoute(normalizedReward.deadline) : normalizeRoute(route),
    reward: normalizedReward,
  };
}

/**
 * Why a reward on `sourceChainId` cannot be escrowed, or `undefined` when it can.
 *
 * On a chain whose native coin IS an ERC-20 (Arc's USDC, `nativeErc20`), the source Portal treats a
 * native amount and a leg of that token as one asset: `publish`, `fund` and `publishAndFund` revert
 * `RewardTokensNotUnique(token)` for a reward that carries both, because funding one would satisfy
 * the other's balance check for free. Exported for the in-program `.reward(...)` lowering, which
 * reports through its own error type.
 */
export function rewardAssetsConflict(
  sourceChainId: bigint | number,
  hasNativeAmount: boolean,
  tokens: readonly AddressInput[],
): string | undefined {
  if (!hasNativeAmount) return undefined;
  const id = Number(sourceChainId);
  const erc20 = nativeErc20(id);
  if (erc20 === undefined) return undefined;
  const alias = toUniversalAddress(erc20.address).toLowerCase();
  if (!tokens.some((token) => toUniversalAddress(token).toLowerCase() === alias)) return undefined;

  const where = chainById(id)?.slug ?? `chain ${id}`;
  const native = getChain(id)!.nativeCurrency;
  return (
    `a reward on ${where} (chain ${id}) offers both a nativeAmount and a ${native.symbol} token leg ` +
    `(${erc20.address}). ${native.symbol} is ${where}'s native coin, so its Portal counts the two as ` +
    `one asset and reverts RewardTokensNotUnique(${erc20.address}) when the reward is published or ` +
    `funded. Fold them into one leg: either the token amount (${erc20.decimals} decimals) or ` +
    `nativeAmount (${native.decimals} decimals); nativeToErc20Amount(${id}, wei) converts between them.`
  );
}

/** Throws {@link rewardAssetsConflict}'s reason, before anything is encoded, signed or sent. */
export function assertRewardAssetsDistinct(sourceChainId: bigint | number, reward: Reward): void {
  const conflict = rewardAssetsConflict(
    sourceChainId,
    reward.nativeAmount > 0n,
    reward.tokens.map((leg) => leg.token),
  );
  if (conflict !== undefined) throw new Error(conflict);
}

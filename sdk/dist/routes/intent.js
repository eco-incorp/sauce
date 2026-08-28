import { emptyRoute, normalizeReward, normalizeRoute } from "./normalize.js";
/**
 * Builds one `Intent` for a leg running from `source` to `destination`.
 * `route === undefined` means a TERMINAL close: the leg gets a synthesized
 * empty route (see `emptyRoute`) instead of a caller-supplied one.
 */
export function assembleIntent(source, destination, route, reward) {
    const normalizedReward = normalizeReward(reward);
    return {
        destination: BigInt(destination.id),
        sourceChainId: BigInt(source.id),
        route: route === undefined ? emptyRoute(normalizedReward.deadline) : normalizeRoute(route),
        reward: normalizedReward,
    };
}
//# sourceMappingURL=intent.js.map
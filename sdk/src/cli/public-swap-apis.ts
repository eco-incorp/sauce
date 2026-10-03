/**
 * THE PUBLIC SWAP APIS THE `sauce` COMMAND AND ITS MCP SERVER ASK FOR ROUTES when they are given
 * none: KyberSwap's keyless aggregator API for `kyberSwap`, Jupiter's keyless Swap API for
 * `jupiterSwap` on Solana. Precedence: `--swap-api <provider>=<url>`, then the `--config` file's
 * `swapApis`, then these. eco-swap has no public endpoint, so `ecoSwap` has no default.
 *
 * The ONE module that holds a swap API's URL (`test/no-embedded-rpc.test.ts` allows exactly this
 * file). Nothing outside `sdk/src/cli/` imports it and the package exports none of it, so it never
 * reaches a browser: the SDK itself takes every URL from its caller (`routes/swap-apis.ts`).
 *
 * KyberSwap rate-limits a request without a client id more strictly; the command sends
 * `x-client-id: sauce`.
 */

/** When the endpoint below was last checked: a route found and built for a Pot on Base. */
export const PUBLIC_SWAP_APIS_VERIFIED = "2026-10-03";

/** KyberSwap's public aggregator API. */
export const KYBER_PUBLIC_API = "https://aggregator-api.kyberswap.com";

/** Jupiter's public Swap API, keyless (its keyed one is `api.jup.ag`). */
export const JUPITER_PUBLIC_API = "https://lite-api.jup.ag";

/** The client id the command sends KyberSwap. */
export const KYBER_CLIENT_ID = "sauce";

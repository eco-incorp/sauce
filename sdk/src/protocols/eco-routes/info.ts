import type { ProtocolInfo } from "../../core/types.js";

export const protocolInfo: ProtocolInfo = {
  name: "Eco Routes",
  slug: "eco-routes",
  description:
    "Eco's cross-chain intent protocol. A Portal publishes an intent, escrows its reward in a per-intent vault, and pays a solver who fulfills the route on the destination chain; a prover carries the proof of that fulfillment back. This is the layer Sauce intents are built on.",
  website: "https://eco.com",
  github: "https://github.com/eco/eco-routes",
  npm: "@eco-foundation/routes-ts",
  category: "infrastructure",
  chains: [],
  audited: true,
};

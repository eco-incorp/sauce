import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "crvUSD",
  slug: "crvusd",
  description:
    "Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.",
  website: "https://crvusd.curve.fi",
  github: "https://github.com/curvefi/curve-stablecoin",
  category: "cdp",
  chains: deployments,
  audited: true,
  tvl: "$500M+",
};

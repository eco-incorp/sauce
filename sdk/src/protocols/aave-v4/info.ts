import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Aave V4",
  slug: "aave-v4",
  description:
    "Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, each addressing its assets by reserve id.",
  website: "https://aave.com",
  github: "https://github.com/aave/aave-v4",
  category: "lending",
  chains: deployments,
  audited: true,
};

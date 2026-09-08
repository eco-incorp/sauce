import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Abracadabra",
  slug: "abracadabra",
  description:
    "Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.",
  website: "https://abracadabra.money",
  github: "https://github.com/Abracadabra-money/abracadabra-money-contracts",
  category: "cdp",
  chains: deployments,
  audited: true,
};

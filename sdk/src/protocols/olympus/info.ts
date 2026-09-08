import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Olympus DAO",
  slug: "olympus",
  description:
    "Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.",
  website: "https://www.olympusdao.finance",
  github: "https://github.com/OlympusDAO/olympus-contracts",
  category: "staking",
  chains: deployments,
  audited: true,
};

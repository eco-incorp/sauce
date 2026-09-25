import type { ProtocolInfo } from "../../core/types.js";

export const protocolInfo: ProtocolInfo = {
  name: "ERC20",
  slug: "erc20",
  description:
    "The ERC-20 token standard interface. Defines the common API for fungible tokens on EVM chains: transfer, approve, transferFrom, balanceOf, allowance, totalSupply, name, symbol, decimals.",
  website: "https://eips.ethereum.org/EIPS/eip-20",
  github: "https://github.com/OpenZeppelin/openzeppelin-contracts",
  npm: "@openzeppelin/contracts",
  category: "infrastructure",
  chains: [],
  audited: true,
};

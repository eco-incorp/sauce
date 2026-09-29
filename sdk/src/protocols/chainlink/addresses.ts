import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Chainlink data feeds directory (reference-data-directory feeds-arc-mainnet.json,
    // "ETH / USD" proxy). getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): description() == "ETH / USD", decimals() == 8. No feed registry or
    // VRF coordinator is published for Arc.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      ethUsdFeed: "0x50FCDD99D6762D1C170DC6A9111db944AEE6D364",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      ethUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      feedRegistry: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf",
      vrfV2Coordinator: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    },
  },
];

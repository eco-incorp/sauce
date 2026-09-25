import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      coreBridge: "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B",
      tokenBridge: "0x3ee18B2214AFF97000D974cf647E7C347E8fa585",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      coreBridge: "0xa5f208e072434bC67592E4C49C1B991BA79BCA46",
      tokenBridge: "0x0b2402144Bb366A632D14B83F244D2e0e21bD39c",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      coreBridge: "0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722",
      tokenBridge: "0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      coreBridge: "0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6",
      tokenBridge: "0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      coreBridge: "0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7",
      tokenBridge: "0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      coreBridge: "0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c",
      tokenBridge: "0x0e082F06FF657D94310cB8cE8B0D9a04541d8052",
    },
  },
];

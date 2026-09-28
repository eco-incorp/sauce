import type { ChainDeployment } from "../../core/types.js";

const META_AGG_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

export const deployments: ChainDeployment[] = [
  { chainId: 1, chainName: "Ethereum", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 42161, chainName: "Arbitrum", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 56, chainName: "BSC", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 137, chainName: "Polygon", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 10, chainName: "Optimism", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 43114, chainName: "Avalanche", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 8453, chainName: "Base", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 250, chainName: "Fantom", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 59144, chainName: "Linea", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  { chainId: 534352, chainName: "Scroll", addresses: { metaAggregationRouter: META_AGG_ROUTER } },
  // zkSync Era addresses differ from the EVM CREATE2 ones: META_AGG_ROUTER has no code there.
  {
    chainId: 324,
    chainName: "zkSync",
    addresses: { metaAggregationRouter: "0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923" },
  },
];

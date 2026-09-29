import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — only the meta-aggregation router: it is the routerAddress KyberSwap's own Arc
    // routes API (aggregator-api.kyberswap.com/arc) returns. KyberSwap Elastic is not on Arc.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      elasticFactory: "0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      elasticFactory: "0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      elasticFactory: "0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      elasticFactory: "0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      elasticFactory: "0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      elasticFactory: "0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a",
      elasticRouter: "0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83",
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      // No Elastic factory/router: the addresses listed here before have no code on Base.
      metaAggregationRouterV2: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    },
  },
];

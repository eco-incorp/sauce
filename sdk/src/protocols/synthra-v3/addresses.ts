import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Synthra V3 (docs.synthra.org/docs/contract-addresses, "Arc mainnet (5042)"). The
    // same deterministic addresses serve Robinhood Chain, except the Universal Router. getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436):
    // swapRouter02, quoterV2 and the position manager each report factory() == factory.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      factory: "0x6307fc239C7964942c1BfFE51930E55606619c74",
      swapRouter02: "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828",
      quoterV2: "0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7",
      nonfungiblePositionManager: "0x2743b771659fD9CE13970d7367e7e84AF6a31049",
    },
  },
];

import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Circle Gateway (docs.arc.io/arc/references/contract-addresses#gateway, domain
    // 26). Both are EIP-1967 proxies. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): domain() == 26 and isTokenSupported(USDC) == true on each.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
      gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
    },
  },
];

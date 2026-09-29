import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — UnitFlow V3 (a Uniswap V3 fork paired against native USDC). Addresses are the
    // mainnet defaults in UnitFlow's own app build (app.unitflow.finance, NEXT_PUBLIC_V3_*_ADDRESS);
    // its GitHub README lists only TESTNET addresses. router, positionManager and quoter are
    // Sourcify-verified UnitFlow sources on Arc. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block 23287436): router.factory() == factory.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      factory: "0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d",
      router: "0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410",
      quoter: "0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34",
    },
  },
];

import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — UnitFlow V3 (a Uniswap V3 fork paired against native USDC), UnitFlow's only
    // chain. Addresses from UnitFlow's contracts page (docs.unitflow.finance/docs/dev/contracts, "Arc
    // Mainnet contract deployments"), which matches the mainnet defaults in its app build; its GitHub
    // README lists only TESTNET addresses. router and quoter are Sourcify-verified UnitFlow sources
    // on Arc. getCode + view-call verified on-chain 2026-09-28 (rpc.mainnet.arc.io, block
    // 23287436): router.factory() == factory, router.USDC() == 0x3600…0000. The position manager
    // (0x300F5f2861eF0d9D3c6B812797C0A4c8b15C86a8) is not registered: this module has no ABI for it.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      factory: "0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d",
      router: "0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410",
      quoter: "0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34",
    },
  },
];

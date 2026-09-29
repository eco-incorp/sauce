import type { ChainDeployment } from "../../core/types.js";

export const deployments: ChainDeployment[] = [
  {
    // Arc (5042) — Uniswap V4 (developers.uniswap.org/docs/protocols/v4/deployments, "Arc: 5042").
    // getCode + view-call verified on-chain 2026-09-28 (Arc mainnet, block 23287436): positionManager.poolManager() and universalRouter.poolManager() == poolManager.
    chainId: 5042,
    chainName: "Arc",
    addresses: {
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      universalRouter: "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1",
      positionManager: "0x6049c9a0e26405C0985f9E3685C87d0aE917f82B",
    },
  },
  {
    // Monad (143) — Uniswap V4 (developers.uniswap.org/…/v4/deployments). Every address
    // getCode-verified on-chain 2026-08-31 (rpc-mainnet.monadinfra.com). universalRouter
    // is shared with the V3 deployment (same 0x0d97dc… on this chain).
    chainId: 143,
    chainName: "Monad",
    addresses: {
      poolManager: "0x188d586ddcf52439676ca21a244753fa19f9ea8e",
      universalRouter: "0x0d97dc33264bfc1c226207428a79b26757fb9dc3",
      positionManager: "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
      positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
      universalRouter: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
      positionManager: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      poolManager: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
      universalRouter: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507",
      positionManager: "0x3c3ea4b57a46241e54610e5f022e5c45859a1017",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
      universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
      positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      poolManager: "0x67366782805870060151383f4bbff9dab53e5cd6",
      universalRouter: "0x1095692a6237d83c6a72f3f5efedb9a670c49223",
      positionManager: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
      universalRouter: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07",
      positionManager: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      poolManager: "0x06380c0e0912312b5150364b9dc4542ba0dbbc85",
      universalRouter: "0x94b75331ae8d42c1b61065089b7d48fe14aa73b7",
      positionManager: "0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd",
    },
  },
  {
    chainId: 81457,
    chainName: "Blast",
    addresses: {
      poolManager: "0x1631559198a9e474033433b2958dabc135ab6446",
    },
  },
];

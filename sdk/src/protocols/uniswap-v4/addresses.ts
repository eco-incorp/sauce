import type { ChainDeployment } from "../../core/types.js";

// `stateView` is v4-periphery's StateView lens over each chain's PoolManager, from
// developers.uniswap.org/docs/protocols/v4/deployments. Every one was probed on 2026-09-30 over a
// public RPC: code at the address, and `StateView.poolManager()` equal to that chain's `poolManager`
// here. Blast is no longer on that page; its StateView passed the same probe.
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
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
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
      stateView: "0x77395f3b2e73ae90843717371294fa97cc419d64",
    },
  },
  {
    chainId: 1,
    chainName: "Ethereum",
    addresses: {
      poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
      positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
      stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    },
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    addresses: {
      poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
      universalRouter: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
      positionManager: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
      stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
    },
  },
  {
    chainId: 10,
    chainName: "Optimism",
    addresses: {
      poolManager: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
      universalRouter: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507",
      positionManager: "0x3c3ea4b57a46241e54610e5f022e5c45859a1017",
      stateView: "0xc18a3169788f4f75a170290584eca6395c75ecdb",
    },
  },
  {
    chainId: 8453,
    chainName: "Base",
    addresses: {
      poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
      universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
      positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
      stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    },
  },
  {
    chainId: 137,
    chainName: "Polygon",
    addresses: {
      poolManager: "0x67366782805870060151383f4bbff9dab53e5cd6",
      universalRouter: "0x1095692a6237d83c6a72f3f5efedb9a670c49223",
      positionManager: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
      stateView: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
    },
  },
  {
    chainId: 56,
    chainName: "BSC",
    addresses: {
      poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
      universalRouter: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07",
      positionManager: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
      stateView: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4",
    },
  },
  {
    chainId: 43114,
    chainName: "Avalanche",
    addresses: {
      poolManager: "0x06380c0e0912312b5150364b9dc4542ba0dbbc85",
      universalRouter: "0x94b75331ae8d42c1b61065089b7d48fe14aa73b7",
      positionManager: "0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd",
      stateView: "0xc3c9e198c735a4b97e3e683f391ccbdd60b69286",
    },
  },
  {
    chainId: 81457,
    chainName: "Blast",
    addresses: {
      poolManager: "0x1631559198a9e474033433b2958dabc135ab6446",
      stateView: "0x12a88ae16f46dce4e8b15368008ab3380885df30",
    },
  },
  {
    // Unichain (130), Zora (7777777), Ink (57073) and Celo (42220): V4's PoolManager and StateView,
    // from developers.uniswap.org/docs/protocols/v4/deployments. Probed 2026-09-30 over public RPCs:
    // code at both, and StateView.poolManager() == poolManager on each chain. The routers on these
    // chains are not registered.
    chainId: 130,
    chainName: "Unichain",
    addresses: {
      poolManager: "0x1f98400000000000000000000000000000000004",
      stateView: "0x86e8631a016f9068c3f085faf484ee3f5fdee8f2",
    },
  },
  {
    chainId: 7777777,
    chainName: "Zora",
    addresses: {
      poolManager: "0x0575338e4c17006ae181b47900a84404247ca30f",
      stateView: "0x385785af07d63b50d0a0ea57c4ff89d06adf7328",
    },
  },
  {
    chainId: 57073,
    chainName: "Ink",
    addresses: {
      poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
      stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
    },
  },
  {
    chainId: 42220,
    chainName: "Celo",
    addresses: {
      poolManager: "0x288dc841A52FCA2707c6947B3A777c5E56cd87BC",
      stateView: "0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb",
    },
  },
];

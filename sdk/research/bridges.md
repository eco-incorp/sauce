# Cross-Chain Bridges & Messaging Research Results

Full JSON data: `bridges-full.json` (33 protocols)

## Intent-Based Bridges

| Protocol          | TVL    | Key Address                                             | Chains              |
| ----------------- | ------ | ------------------------------------------------------- | ------------------- |
| Across Protocol   | $650M+ | HubPool + SpokePool                                     | 22 chains           |
| deBridge (DLN)    | $50M+  | DlnSource: `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | All EVM (same addr) |
| Connext/Everclear | $50M+  | Hub+spoke clearing layer                                | Multi-chain         |

## Liquidity Pool Bridges

| Protocol             | TVL    | Key Address                      | Chains      |
| -------------------- | ------ | -------------------------------- | ----------- |
| Stargate (LayerZero) | $510M+ | Omnichain pools, delta algorithm | Multi-chain |
| Celer cBridge        | $150M+ | SGN validator network            | Multi-chain |
| Synapse Protocol     | $122M+ | nUSD/nETH synthetics + CCTP      | Multi-chain |
| Hop Protocol         | $30M+  | hToken AMM model                 | L2s         |

## Message Passing Protocols

| Protocol       | TVL    | Key Address                                                 | Chains          |
| -------------- | ------ | ----------------------------------------------------------- | --------------- |
| LayerZero V2   | -      | EndpointV2: `0x1a44076050125825900e736c501f859c50fE728c`    | 40+ (same addr) |
| Wormhole       | $3B+   | CoreBridge + TokenBridge per chain                          | 19 guardians    |
| Axelar         | $500M+ | Gateway + ITS: `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | 60+ chains      |
| Hyperlane      | $100M+ | Permissionless Mailbox contracts                            | 150+ chains     |
| Chainlink CCIP | $1B+   | Router contracts + ARM anti-fraud                           | 100+ chains     |

## Bridge Aggregators

| Protocol      | Key Address                                                 | Chains               |
| ------------- | ----------------------------------------------------------- | -------------------- |
| Socket/Bungee | SocketGateway: `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | Most EVM (same addr) |
| LI.FI         | LiFiDiamond: `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`   | Most EVM (same addr) |
| Squid Router  | SquidRouter: `0xce16F69375520ab01377ce7B88f5BA8C48F8D666`   | Axelar-powered       |

## Native L2 Bridges

| Chain         | TVL    | L1 Contract        | Address                                      |
| ------------- | ------ | ------------------ | -------------------------------------------- |
| Arbitrum      | $10B+  | L1GatewayRouter    | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` |
| Optimism      | $8B+   | L1StandardBridge   | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` |
| Base          | $7B+   | L1StandardBridge   | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` |
| Polygon PoS   | $2B+   | RootChainManager   | `0xA0c68C638235ee32657e8f720a23ceC1bFc77C77` |
| zkSync Era    | $1B+   | DiamondProxy       | `0x32400084C286CF3E17e7B677ea9583e60a000324` |
| Mantle        | $1B+   | L1StandardBridge   | `0x95fC37A27a2f68e3A647CDc081F0A89BB47c3012` |
| Blast         | $1B+   | L1BlastBridge      | `0x3a05E5d33d7Ab3864D53aaEc93c8301C1Fa49115` |
| Scroll        | $500M+ | L1ScrollMessenger  | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` |
| Linea         | $500M+ | L1MessageService   | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` |
| Polygon zkEVM | $50M+  | PolygonZkEVMBridge | `0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe` |

## Other

| Protocol        | Notes                                  |
| --------------- | -------------------------------------- |
| Orbiter Finance | Maker/EOA-based, fast rollup-to-rollup |
| Rhino.fi        | StarkEx-based liquidity layer          |
| Router Protocol | CrossTalk framework + Nitro transfers  |

## Deprecated/Compromised (DO NOT INTEGRATE)

- **Multichain (Anyswap)** - COMPROMISED July 2023, $125M+ stolen
- **Poly Network** - COMPROMISED twice (Aug 2021, July 2023)

## CREATE2 Shared Addresses

Several protocols deploy identical addresses across all chains:

- LayerZero EndpointV2: `0x1a44076050125825900e736c501f859c50fE728c`
- Axelar ITS: `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C`
- deBridge DlnSource: `0xeF4fB24aD0916217251F553c0596F8Edc630EB66`
- LI.FI Diamond: `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`
- Socket Gateway: `0x3a23F943181408EAC424116Af7b7790c94Cb97a5`
- Squid Router: `0xce16F69375520ab01377ce7B88f5BA8C48F8D666`

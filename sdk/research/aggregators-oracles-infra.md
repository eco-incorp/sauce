# Aggregators, Oracles & Infrastructure Research Results

## DEX Aggregators

| Protocol                | Address                                      | Chains                                                                                     | npm                           |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| 1inch v6                | `0x111111125421cA6dc452d289314280a0f8842A65` | Ethereum, Arbitrum, Optimism, Base, BSC, Polygon, Avalanche, Gnosis, Fantom, zkSync        | `@1inch/fusion-sdk`           |
| 1inch v5                | `0x1111111254EEB25477B68fb85Ed929f73A960582` | Ethereum, Arbitrum, Optimism, Base, BSC, Polygon, Avalanche, Gnosis, Fantom                | `@1inch/limit-order-protocol` |
| Paraswap v5 Augustus    | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | Ethereum, BSC, Polygon, Avalanche, Fantom, Arbitrum, Optimism                              | `@paraswap/sdk`               |
| Paraswap v6             | `0x6A000F20005980200259B80c5102003040001068` | Ethereum, Polygon, Optimism, Arbitrum, Base, BSC                                           |                               |
| 0x Exchange Proxy       | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | Ethereum, Polygon, BSC, Avalanche, Fantom, Celo, Optimism, Arbitrum, Base                  | `@0x/contract-addresses`      |
| CowSwap GPv2            | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | Ethereum, Gnosis, Arbitrum                                                                 | `@cowprotocol/cow-sdk`        |
| OpenOcean v2            | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | Ethereum, BSC, Polygon, Avalanche, Fantom, Arbitrum, Optimism                              |                               |
| KyberSwap MetaAggRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | Ethereum, Arbitrum, BSC, Polygon, Optimism, Avalanche, Base, Fantom, Linea, Scroll, zkSync | `@kyberswap/ks-sdk-core`      |

## Oracles

| Protocol                | Key Address (Ethereum)                       | Type           | npm                               |
| ----------------------- | -------------------------------------------- | -------------- | --------------------------------- |
| Chainlink ETH/USD       | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | Push-based     | `@chainlink/contracts`            |
| Chainlink Feed Registry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | Registry       |                                   |
| Chainlink VRF v2        | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | VRF            |                                   |
| Pyth Oracle             | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` | Pull-based     | `@pythnetwork/pyth-evm-js`        |
| RedStone                | Per-integration adapter                      | Pull-based     | `@redstone-finance/evm-connector` |
| API3                    | Per-feed proxy                               | First-party    | `@api3/contracts`                 |
| Tellor Flex             | `0x8cFc184c877154a8F9ffE0fe75649dbe5e2DBEBf` | Permissionless | `usingtellor`                     |

## CDPs & Stablecoins

| Protocol               | Token Address                                | Token  | TVL    |
| ---------------------- | -------------------------------------------- | ------ | ------ |
| MakerDAO DAI           | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | DAI    | $8B+   |
| MakerDAO USDS          | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | USDS   |        |
| MakerDAO sDAI          | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | sDAI   |        |
| MakerDAO Vat           | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | -      |        |
| Liquity v1 LUSD        | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | LUSD   | $500M+ |
| Liquity v1 BorrowerOps | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | -      |        |
| Liquity v2 BOLD        | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | BOLD   | $1B+   |
| Ethena USDe            | `0x4c9EDD5852cd905f086C759E8383e09bff1e68b3` | USDe   | $5B+   |
| Ethena sUSDe           | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | sUSDe  |        |
| GHO (Aave)             | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | GHO    | $500M+ |
| FRAX                   | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | FRAX   | $1B+   |
| crvUSD                 | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | crvUSD | $500M+ |
| Abracadabra MIM        | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | MIM    | $200M+ |
| Angle EURA             | `0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8` | EURA   | $100M+ |
| Prisma mkUSD           | `0x4591DBfF62656E7859Afe5e45f6f47D3669fBB28` | mkUSD  | $100M+ |
| Mountain USDM          | `0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C` | USDM   | $200M+ |
| Usual USD0             | `0x73A15FeD60Bf67631dC6cd7Bc5B6e8da8190ACf5` | USD0   | $800M+ |
| Gravita GRAI (Arb)     | `0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487` | GRAI   | $30M+  |

## Infrastructure

| Protocol              | Key Address                                  | Purpose         | npm                             |
| --------------------- | -------------------------------------------- | --------------- | ------------------------------- |
| Safe v1.4.1 Singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | Multisig        | `@safe-global/safe-deployments` |
| Safe v1.3.0 L1        | `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` | Multisig        |                                 |
| Safe v1.3.0 L2        | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | Multisig        |                                 |
| Permit2               | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Approvals       | `@uniswap/permit2-sdk`          |
| ENS Registry          | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | Names           | `@ensdomains/ensjs`             |
| ENS BaseRegistrar     | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | Names           |                                 |
| Seaport 1.6           | `0x0000000000000068F116a894984e2DB1123eB395` | NFT Marketplace | `@opensea/seaport-js`           |
| Seaport 1.5           | `0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC` | NFT Marketplace |                                 |
| Gelato                | Per-chain                                    | Automation      | `@gelatonetwork/automate-sdk`   |

## Payments & Streaming

| Protocol                 | Key Address (Ethereum)                       | npm                                 |
| ------------------------ | -------------------------------------------- | ----------------------------------- |
| Sablier v2 LockupLinear  | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `@sablier/sdk`                      |
| Superfluid Host          | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `@superfluid-finance/sdk-core`      |
| Superfluid CFA Forwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |                                     |
| Request ERC20FeeProxy    | `0x370DE27fdb7D1Ff1e1BaA7D11c5820a324Cf623C` | `@requestnetwork/request-client.js` |

## NFT Marketplaces

| Protocol             | Key Address (Ethereum)                       | npm                 |
| -------------------- | -------------------------------------------- | ------------------- |
| Blur Marketplace v2  | `0x39da41747a83aeE658334415666f3EF92DD0D541` |                     |
| Blur Blend (Lending) | `0x29469395eAf6f95920E59F858042f0e28D98a20B` |                     |
| LooksRare Exchange   | `0x59728544B08AB483533076417FbBB2fD0B17CE3a` | `@looksrare/sdk-v2` |
| X2Y2 Exchange        | `0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3` | (sunsetting)        |

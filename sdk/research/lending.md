# Lending & Borrowing Protocols Research Results

## Tier 1 (>$1B TVL)

### Aave V3 (~$40B TVL)

- GitHub: https://github.com/aave/aave-v3-core
- npm: `@aave/core-v3`, `@bgd-labs/aave-address-book`
- Functions: supply, withdraw, borrow, repay, liquidationCall, flashLoan

| Chain     | Pool                                         | PoolAddressesProvider                        |
| --------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum  | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` |
| Polygon   | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Arbitrum  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Optimism  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Avalanche | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Base      | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` |
| BSC       | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | -                                            |
| Scroll    | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | -                                            |
| zkSync    | `0x78e30497a3c7527d953c6b1e3541b021a98ac43c` | -                                            |
| Fantom    | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Gnosis    | `0xb50201558B00496A145fE76f7424749556E326D8` | -                                            |
| Metis     | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` | -                                            |

### Aave V2 (~$2B legacy)

| Chain     | LendingPool                                  | AddressesProvider                            |
| --------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum  | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5` |
| Polygon   | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `0xd05e3E715d945B59290df0ae8eF85c1BdB684744` |
| Avalanche | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `0xb6A86025F0FE1862B372cb0ca18CE3EDe02A318f` |

### MakerDAO/Sky (~$8B)

- GitHub: https://github.com/makerdao/dss

| Contract   | Address (Ethereum)                           |
| ---------- | -------------------------------------------- |
| DAI        | `0x6B175474E89094C44Da98b954EedeAC495271d0F` |
| USDS       | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` |
| sDAI       | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` |
| Vat        | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` |
| Pot (DSR)  | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` |
| Jug        | `0x19c0976f590D67707E62397C87829d896Dc0f1F1` |
| DSRManager | `0x373238337Bfe1146fb49989fc222523f83081dDb` |
| Chainlog   | `0xdA0Ab1e0017DEbCd72Be8599041a2aa3bA7e740F` |

### Morpho Blue (~$6B)

- GitHub: https://github.com/morpho-org/morpho-blue
- npm: `@morpho-org/morpho-blue`

| Chain    | Morpho                                       | Bundler3                                     |
| -------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` |
| Base     | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | -                                            |

### Spark Protocol (~$5B)

- GitHub: https://github.com/sparkdotfi/sparklend-deployments

| Chain    | Pool                                         | AddressesProvider                            |
| -------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` |
| Gnosis   | `0x2Dae5307c5E3FD1CF5A72Cb6F698f915860607e0` | -                                            |

### Compound V3 Comet (~$3.5B)

- GitHub: https://github.com/compound-finance/comet
- npm: `@compound-finance/comet`

| Chain    | Market  | Address                                      |
| -------- | ------- | -------------------------------------------- |
| Ethereum | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` |
| Ethereum | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` |
| Ethereum | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` |
| Arbitrum | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` |
| Arbitrum | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` |
| Base     | cUSDCv3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| Base     | cWETHv3 | `0x46e6b214b524310239732D51387075E0e70970bf` |
| Polygon  | cUSDCv3 | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` |
| Optimism | cUSDCv3 | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` |
| Scroll   | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` |

### Compound V2 (~$1B legacy, Ethereum)

| Contract    | Address                                      |
| ----------- | -------------------------------------------- |
| Comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` |
| cETH        | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` |
| cUSDC       | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` |
| cDAI        | `0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643` |
| COMP        | `0xc00e94Cb662C3520282E6f5717214004A7f26888` |

### Venus (~$3B, BSC)

| Contract    | Address                                      |
| ----------- | -------------------------------------------- |
| Comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` |
| vBNB        | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` |
| XVS         | `0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63` |

### Fluid/Instadapp (~$2B)

| Chain    | Liquidity                                    |
| -------- | -------------------------------------------- |
| Ethereum | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |
| Arbitrum | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |

### Euler V2 (~$1B)

- GitHub: https://github.com/euler-xyz/euler-vault-kit
- EVC: `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` (Ethereum)
- EUL: `0xd9Fcd98c322942075A5C3860693e9f4f03AAE07b`

## Tier 2 ($100M-$1B)

| Protocol     | TVL    | Chain(s)                             | Key Address                                                      |
| ------------ | ------ | ------------------------------------ | ---------------------------------------------------------------- |
| Benqi        | ~$800M | Avalanche                            | Comptroller: `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`        |
| Moonwell     | ~$700M | Base, Optimism, Moonbeam             | Comptroller (Base): `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Silo Finance | ~$500M | Ethereum, Arbitrum                   | SiloRepository: `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49`     |
| LayerBank    | ~$300M | Scroll, Linea, 8+ L2s                | Core (Scroll): `0x009a0b7C38B542208936F1179151CD08E2943833`      |
| Seamless     | ~$200M | Base                                 | SEAM: `0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85`               |
| ZeroLend     | ~$100M | zkSync, Linea, Blast, Ethereum, Base | Pool (zkSync): `0x4d9429246EA989C9CeE203B43F6d1D7D83e3B8F8`      |
| Exactly      | ~$100M | Optimism                             | MarketUSDC: `0x81C9A7B55A4df39A9B7B5F781ec0e53539694873`         |

## Tier 3 (<$100M)

| Protocol    | TVL   | Chain(s)                | Key Address                                                     |
| ----------- | ----- | ----------------------- | --------------------------------------------------------------- |
| Radiant     | ~$50M | Arbitrum, BSC           | LendingPool (Arb): `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` |
| dForce      | ~$50M | Ethereum + 5 chains     | iETH: `0x5ACD75f21659a59fFaB9AEBAf350351a8bfaAbc0`              |
| Ionic       | ~$50M | Mode, Base              | -                                                               |
| Sonne       | ~$30M | Optimism, Base          | Comptroller (OP): `0x60CF091cD3f50420d50fD7f707414d0DF4751C58`  |
| Mendi       | ~$30M | Linea                   | Comptroller: `0x1b4d3b0421dDc1eB216D230Bc01527422Fb93103`       |
| Lodestar    | ~$20M | Arbitrum                | Comptroller: `0xa86DD95c210dd186Fa7639F93E4177E97d057576`       |
| Pac Finance | ~$20M | Blast                   | PAC: `0x7a2E709C3AEd2b6aA9Dd9C2D054A5CcB0c576118`               |
| Iron Bank   | ~$20M | Ethereum, Fantom        | -                                                               |
| Orbit       | ~$15M | Blast                   | ORBIT: `0x42E12D42b3d6c4A74a88A61063856756ea2DB357`             |
| Granary     | ~$10M | Multi-chain             | -                                                               |
| WePiggy     | ~$5M  | 10+ chains              | WPC: `0x6F620EC89B8479e97A6985792d0c64F237566746`               |
| Geist       | ~$5M  | Fantom                  | LendingPool: `0x9FAD24f572045c7869117160A571B2e50b10d068`       |
| Hundred     | ~$1M  | Multi-chain (post-hack) | -                                                               |

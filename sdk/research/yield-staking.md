# Yield, Staking & Restaking Research Results

## Liquid Staking (12 protocols)

| Protocol     | TVL    | Token   | Ethereum Address                             | Chains                                             |
| ------------ | ------ | ------- | -------------------------------------------- | -------------------------------------------------- |
| Lido         | $27.5B | stETH   | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | ETH + bridged wstETH everywhere                    |
|              |        | wstETH  | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | Arb: `0x5979D7b546E38E414F7E9822514be443A4800529`  |
| Rocket Pool  | $3B    | rETH    | `0xae78736Cd615f374D3085123A210448E74Fc6393` | Arb/OP/Base bridged                                |
| Coinbase     | $2.5B  | cbETH   | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | Base: `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |
| Mantle mETH  | $1.5B  | mETH    | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | Ethereum                                           |
| Binance      | $1B    | wBETH   | `0xa2E3356610840701BDf5611a53974510Ae27E2e1` | BSC + Ethereum                                     |
| Swell        | $800M  | swETH   | `0xf951E335afb289353dc249e82926178EaC7DEd78` | Ethereum                                           |
|              |        | rswETH  | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` |                                                    |
| Frax Ether   | $700M  | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | Ethereum + OP                                      |
| Benqi sAVAX  | $500M  | sAVAX   | `0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE` | Avalanche                                          |
| StakeWise    | $400M  | osETH   | `0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38` | Ethereum                                           |
| Stader       | $300M  | ETHx    | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | Ethereum                                           |
| Origin Ether | $300M  | OETH    | `0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3` | Ethereum                                           |
| Ankr         | $200M  | ankrETH | `0xE95A203B1a91a908F9B9CE46459d101078c2c3cb` | Ethereum                                           |

## Restaking (8 protocols)

| Protocol   | TVL   | Token      | Key Contract (Ethereum)                                                                                 |
| ---------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------- |
| EigenLayer | $13B  | EIGEN      | StrategyManager: `0x858646372CC42E1A627fcE94aa7A7033e7CF075A`                                           |
|            |       |            | DelegationManager: `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A`                                         |
| ether.fi   | $5.8B | eETH/weETH | eETH: `0x35fA164735182de50811E8e2E824cFb9B6118ac2`, weETH: `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` |
| Kelp DAO   | $2B   | rsETH      | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7`                                                            |
| Symbiotic  | $2B   | -          | Factory: `0x1BC8FCFbE6Aa17e4A7610F51B888f34583D202Ec`                                                   |
| Karak      | $500M | KARAK      | VaultSupervisor: `0x54e44DbB92DbA848ACE27F44c0CB4268981eF1CC`                                           |
| Renzo      | $389M | ezETH      | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`                                                            |
| Bedrock    | $150M | uniETH     | `0xF1376bceF0f78459C0Ed0ba5ddce976F1ddF51F4`                                                            |
| Puffer     | $62M  | pufETH     | `0xD9A442856C234a39a81a089C06451EBAa4306a72`                                                            |

### EigenLayer Strategy Contracts

| Asset   | Strategy Address                             |
| ------- | -------------------------------------------- |
| stETH   | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` |
| rETH    | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` |
| cbETH   | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` |
| ETHx    | `0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d` |
| ankrETH | `0x13760F50a9d7377e4F20CB8CF9e4c26586c658ff` |
| OETH    | `0xa4C637e0F704745D182e4D38cAb7E7485321d059` |
| osETH   | `0x57ba429517c3473B6d34CA9aCd56c0e735b94c02` |
| swETH   | `0x0Fe4F44beE93503346A3Ac9EE5A26b130a5796d6` |
| wBETH   | `0x7CA911E83dabf90C90dD3De5411a10F1A6112184` |
| sfrxETH | `0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6` |
| mETH    | `0x298aFB19A105D59E74658C4C334Ff360BadE6dd2` |

## Yield Aggregators (9 protocols)

| Protocol     | TVL   | Token  | Key Contract (Ethereum)                                    | npm              |
| ------------ | ----- | ------ | ---------------------------------------------------------- | ---------------- |
| Convex       | $2B   | CVX    | Booster: `0xF403C135812408BFbE8713b5A23a04b3D48AAE31`      | -                |
| Pendle       | $2.6B | PENDLE | Router: `0x888888888889758F76e7103c6CbF23ABbF58F946`       | `@pendle/sdk-v2` |
| Yearn v3     | $500M | YFI    | Factory: `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F`      | -                |
| Beefy        | $300M | BIFI   | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1`               | -                |
| Sommelier    | $100M | SOMM   | RealYieldETH: `0xb5b29320d2dde5ba5bafa1ebcd270052070483ec` | -                |
| Concentrator | $50M  | aCRV   | `0x2b95A1Dcc3D405535f9ed33c219ab38E8d7e0884`               | -                |
| Harvest      | $50M  | FARM   | `0xa0246c9032bC3A600820415aE600c6388619A14d`               | -                |
| Idle         | $30M  | IDLE   | `0x875773784Af8135eA0ef43b5a374AaD105c5D39e`               | -                |
| Badger       | $30M  | BADGER | `0x3472A5A71965499acd81997a54BBA8D852C6E53d`               | -                |

## LP Management (2 protocols)

| Protocol         | TVL   | Key Contract (Ethereum)                                |
| ---------------- | ----- | ------------------------------------------------------ |
| Gamma Strategies | $200M | UniProxy: `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` |
| Arrakis Finance  | $50M  | Factory: `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9`  |

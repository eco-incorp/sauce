<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V3 (`aave-v3`)

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets. The most widely deployed lending protocol in DeFi.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3` |
| Namespace | `AaveV3` on ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| Chains | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| Document | [aave-v3.md](../aave-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `AaveV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's pool, `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`.
  require(AaveV3.Pool != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `AaveV3.Pool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | no registry ABI |
| [Optimism](../../../sauce-chains/references/optimism.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | no registry ABI |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `AaveV3.Pool` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool` |
| [Polygon](../../../sauce-chains/references/polygon.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Polygon](../../../sauce-chains/references/polygon.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | no registry ABI |
| [Monad](../../../sauce-chains/references/monad.md) | pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `AaveV3.Pool` |
| [Monad](../../../sauce-chains/references/monad.md) | poolAddressesProvider | `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615` | no registry ABI |
| [Fantom](../../../sauce-chains/references/fantom.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Metis](../../../sauce-chains/references/metis.md) | pool | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` | `AaveV3.Pool` |
| [Base](../../../sauce-chains/references/base.md) | pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `AaveV3.Pool` |
| [Base](../../../sauce-chains/references/base.md) | poolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | no registry ABI |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | no registry ABI |
| [Scroll](../../../sauce-chains/references/scroll.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool` |

## ABI

### `PoolABI`

`import PoolABI from "./protocols/aave-v3/PoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
- `flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)`
- `liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)`
- `getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)`

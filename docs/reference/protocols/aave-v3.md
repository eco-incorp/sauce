<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V3 (`aave-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aave V3 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV3` on ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, base-sepolia, scroll, sepolia |
| Chains | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, base-sepolia, scroll, sepolia |

## When to use it

- Earn interest on an asset the market lists, or borrow one against everything you supplied in
  that market. One Pool per market holds every reserve.
- Choose it over Compound V3 when you need to borrow more than one asset against shared
  collateral, and over Morpho Blue when you want one shared market rather than isolated ones.

## Pitfalls for a program

- `supply` pulls the asset with `transferFrom`: approve the Pool for exactly the amount first.
- `onBehalfOf` receives the aTokens, and with them the position. Every call comes from the Pot,
  so `pot` there keeps the position in the Pot, not in the user's wallet; choose which, and
  pass the wallet as a `main` parameter to give it to the user. A position in the wallet is the
  wallet's: `withdraw` burns the caller's aTokens, so a later cook withdraws it only once they are
  back in the Pot, and borrows against it only with the wallet's credit delegation.
- The aToken minted to `onBehalfOf` is rebasing: its balance grows with interest, so measure it
  as a delta, not as the amount supplied.
- A reserve can be frozen, paused or at its supply cap, and then `supply` reverts.
- Borrowing needs collateral and keeps the position's health factor (from
  `getUserAccountData`, scaled by 1e18) above 1; below it, anyone may liquidate.
- `withdraw` with `~0` withdraws everything; it reverts if that would leave a borrow
  undercollateralized.
- `flashLoanSimple` calls back a receiver contract, which a Sauce program cannot be.

## In a Sauce program

Supply the Pot's USDC for `onBehalfOf` (the user's wallet, or `pot` to keep the position in
the Pot) and check the position now has collateral:

```ts
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
  const account = AaveV3.Pool.getUserAccountData(onBehalfOf);
  require(account.totalCollateralBase > 0, "nothing supplied");
}
```

## Notes

- interestRateMode: 1 = stable (deprecated on most markets), 2 = variable
- referralCode is always 0 (referral program inactive)
- V3 introduced efficiency mode (eMode) for correlated assets, isolation mode for new assets, and siloed borrowing
- All supply/repay operations require prior ERC-20 approval to the Pool address
- healthFactor < 1e18 means position is liquidatable
- TVL: $40B+. Audited

## Its names in a program

On Ethereum, `AaveV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's pool, `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`.
  require(AaveV3.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `AaveV3.Pool` |
| [Ethereum](../chains/ethereum.md) | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | `AaveV3.PoolAddressesProvider` |
| [Optimism](../chains/optimism.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Optimism](../chains/optimism.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [BNB Chain](../chains/bsc.md) | pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `AaveV3.Pool` |
| [Gnosis](../chains/gnosis.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool` |
| [Polygon](../chains/polygon.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Polygon](../chains/polygon.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Monad](../chains/monad.md) | pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `AaveV3.Pool` |
| [Monad](../chains/monad.md) | poolAddressesProvider | `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615` | `AaveV3.PoolAddressesProvider` |
| [Fantom](../chains/fantom.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Metis](../chains/metis.md) | pool | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` | `AaveV3.Pool` |
| [Base](../chains/base.md) | pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `AaveV3.Pool` |
| [Base](../chains/base.md) | poolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | `AaveV3.PoolAddressesProvider` |
| [Arbitrum One](../chains/arbitrum.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Arbitrum One](../chains/arbitrum.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Avalanche C-Chain](../chains/avalanche.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Avalanche C-Chain](../chains/avalanche.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Base Sepolia](../chains/base-sepolia.md) | pool | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | `AaveV3.Pool` |
| [Base Sepolia](../chains/base-sepolia.md) | poolAddressesProvider | `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00` | `AaveV3.PoolAddressesProvider` |
| [Scroll](../chains/scroll.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool` |
| [Ethereum Sepolia](../chains/sepolia.md) | pool | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | `AaveV3.Pool` |
| [Ethereum Sepolia](../chains/sepolia.md) | poolAddressesProvider | `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A` | `AaveV3.PoolAddressesProvider` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

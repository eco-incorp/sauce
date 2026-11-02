<!-- Generated from the SDK's registries. Do not edit. -->

# Alchemix (`alchemix`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Alchemix is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Alchemix` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit yield-bearing token as collateral
- **withdraw**: Withdraw collateral
- **mint**: Borrow synthetic asset (alUSD or alETH) against collateral
- **burn**: Repay synthetic asset debt

## Notes

- Self-repaying: yield from deposited collateral automatically reduces debt over time
- Two Alchemist contracts: alchemistAlUSD (for USD synthetics) and alchemistAlETH (for ETH synthetics)
- Max LTV: 50% - can borrow up to half the value of deposited collateral
- yieldToken is the yield-bearing version (e.g. yvDAI, aDAI, stETH), not the base token
- Approve yieldToken to the appropriate Alchemist contract before depositing
- debt is int256 because it can be negative (overpaid/surplus)

## Its names in a program

On Ethereum, `Alchemix` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's alETH, `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6`.
  require(Alchemix.AlETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | `Alchemix.AlETH` |
| [Ethereum](../chains/ethereum.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | `Alchemix.AlUSD` |
| [Ethereum](../chains/ethereum.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `Alchemix.AlchemistAlETH` |
| [Ethereum](../chains/ethereum.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1AdD94dd` | `Alchemix.AlchemistAlUSD` |

## ABI

### `AlchemistABI`

`import AlchemistABI from "./protocols/alchemix/AlchemistABI.json";` Speaks for: alchemistAlUSD, alchemistAlETH. The import is the contract's full ABI across every deployment; call it through the `Alchemix` namespace to have a function a chain's deployment does not run refused.

- `acceptAdmin()`
- `accounts(address owner) view returns (int256 debt, address[] depositedTokens)`
- `addUnderlyingToken(address underlyingToken, (uint256 repayLimitMinimum, uint256 repayLimitMaximum, uint256 repayLimitBlocks, uint256 liquidationLimitMinimum, uint256 liquidationLimitMaximum, uint256 liquidationLimitBlocks) config)`
- `addYieldToken(address yieldToken, (address adapter, uint256 maximumLoss, uint256 maximumExpectedValue, uint256 creditUnlockBlocks) config)`
- `admin() view returns (address)`
- `approveMint(address spender, uint256 amount)`
- `approveWithdraw(address spender, address yieldToken, uint256 shares)`
- `BPS() view returns (uint256)`
- `burn(uint256 amount, address recipient) returns (uint256)`
- `configureCreditUnlockRate(address yieldToken, uint256 blocks)`
- `configureLiquidationLimit(address underlyingToken, uint256 maximum, uint256 blocks)`
- `configureMintingLimit(uint256 maximum, uint256 rate)`
- `configureRepayLimit(address underlyingToken, uint256 maximum, uint256 blocks)`
- `convertSharesToUnderlyingTokens(address yieldToken, uint256 shares) view returns (uint256)`
- `convertSharesToYieldTokens(address yieldToken, uint256 shares) view returns (uint256)`
- `convertUnderlyingTokensToShares(address yieldToken, uint256 amount) view returns (uint256)`
- `convertUnderlyingTokensToYield(address yieldToken, uint256 amount) view returns (uint256)`
- `convertYieldTokensToShares(address yieldToken, uint256 amount) view returns (uint256)`
- `convertYieldTokensToUnderlying(address yieldToken, uint256 amount) view returns (uint256)`
- `debtToken() view returns (address)`
- `deposit(address yieldToken, uint256 amount, address recipient) returns (uint256 shares)`
- `depositUnderlying(address yieldToken, uint256 amount, address recipient, uint256 minimumAmountOut) returns (uint256)`
- `donate(address yieldToken, uint256 amount)`
- `FIXED_POINT_SCALAR() view returns (uint256)`
- `getLiquidationLimitInfo(address underlyingToken) view returns (uint256 currentLimit, uint256 rate, uint256 maximum)`
- `getMintLimitInfo() view returns (uint256 currentLimit, uint256 rate, uint256 maximum)`
- `getRepayLimitInfo(address underlyingToken) view returns (uint256 currentLimit, uint256 rate, uint256 maximum)`
- `getSupportedUnderlyingTokens() view returns (address[])`
- `getSupportedYieldTokens() view returns (address[])`
- `getUnderlyingTokenParameters(address underlyingToken) view returns ((uint8 decimals, uint256 conversionFactor, bool enabled))`
- `getUnderlyingTokensPerShare(address yieldToken) view returns (uint256)`
- `getYieldTokenParameters(address yieldToken) view returns ((uint8 decimals, address underlyingToken, address adapter, uint256 maximumLoss, uint256 maximumExpectedValue, uint256 creditUnlockRate, uint256 activeBalance, uint256 harvestableBalance, uint256 totalShares, uint256 expectedValue, uint256 pendingCredit, uint256 distributedCredit, uint256 lastDistributionBlock, uint256 accruedWeight, bool enabled))`
- `getYieldTokensPerShare(address yieldToken) view returns (uint256)`
- `harvest(address yieldToken, uint256 minimumAmountOut)`
- `initialize((address admin, address debtToken, address transmuter, uint256 minimumCollateralization, uint256 protocolFee, address protocolFeeReceiver, uint256 mintingLimitMinimum, uint256 mintingLimitMaximum, uint256 mintingLimitBlocks, address whitelist) params)`
- `isSupportedUnderlyingToken(address underlyingToken) view returns (bool)`
- `isSupportedYieldToken(address yieldToken) view returns (bool)`
- `keepers(address) view returns (bool)`
- `liquidate(address yieldToken, uint256 shares, uint256 minimumAmountOut) returns (uint256)`
- `minimumCollateralization() view returns (uint256)`
- `mint(uint256 amount, address recipient)`
- `mintAllowance(address owner, address spender) view returns (uint256)`
- `mintFrom(address owner, uint256 amount, address recipient)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `normalizeDebtTokensToUnderlying(address underlyingToken, uint256 amount) view returns (uint256)`
- `normalizeUnderlyingTokensToDebt(address underlyingToken, uint256 amount) view returns (uint256)`
- `pendingAdmin() view returns (address)`
- `poke(address owner)`
- `positions(address owner, address yieldToken) view returns (uint256 shares, uint256 lastAccruedWeight)`
- `protocolFee() view returns (uint256)`
- `protocolFeeReceiver() view returns (address)`
- `repay(address underlyingToken, uint256 amount, address recipient) returns (uint256)`
- `sentinels(address) view returns (bool)`
- `setKeeper(address keeper, bool flag)`
- `setMaximumExpectedValue(address yieldToken, uint256 value)`
- `setMaximumLoss(address yieldToken, uint256 value)`
- `setMinimumCollateralization(uint256 value)`
- `setPendingAdmin(address value)`
- `setProtocolFee(uint256 value)`
- `setProtocolFeeReceiver(address value)`
- `setSentinel(address sentinel, bool flag)`
- `setTokenAdapter(address yieldToken, address adapter)`
- `setTransferAdapterAddress(address transferAdapterAddress)`
- `setTransmuter(address value)`
- `setUnderlyingTokenEnabled(address underlyingToken, bool enabled)`
- `setYieldTokenEnabled(address yieldToken, bool enabled)`
- `snap(address yieldToken)`
- `sweep(address yieldToken)`
- `totalValue(address owner) view returns (uint256)`
- `transferAdapter() view returns (address)`
- `transferDebtV1(address owner, int256 debt)`
- `transmuter() view returns (address)`
- `version() view returns (string)`
- `whitelist() view returns (address)`
- `withdraw(address yieldToken, uint256 shares, address recipient) returns (uint256 amountWithdrawn)`
- `withdrawAllowance(address owner, address spender, address yieldToken) view returns (uint256)`
- `withdrawFrom(address owner, address yieldToken, uint256 shares, address recipient) returns (uint256)`
- `withdrawUnderlying(address yieldToken, uint256 shares, address recipient, uint256 minimumAmountOut) returns (uint256)`
- `withdrawUnderlyingFrom(address owner, address yieldToken, uint256 shares, address recipient, uint256 minimumAmountOut) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

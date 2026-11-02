<!-- Generated from the SDK's registries. Do not edit. -->

# Kelp DAO (`kelp`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Kelp DAO is a restaking protocol: staked coins put to work securing other services too. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquid restaking protocol built on EigenLayer. Deposit LSTs (stETH, ETHx, etc.) and receive rsETH, a non-rebasing liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Kelp` on ethereum |
| Chains | ethereum |

## What it offers

- **depositAsset**: Deposit LST to receive rsETH

## Notes

- TVL: $2B+. Accepts stETH, ETHx, and other LSTs
- Approve the LST to lrtDepositPool before depositing
- minRSETHAmountExpected provides slippage protection
- Use getRsETHAmountToMint() to preview output before depositing

## Its names in a program

On Ethereum, `Kelp` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lrtDepositPool, `0x036676389e48133B63a802f8635AD39E752D375D`.
  require(Kelp.LRTDepositPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `Kelp.LRTDepositPool` |
| [Ethereum](../chains/ethereum.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `Kelp.RsETH` |

## ABI

### `LRTDepositPoolABI`

`import LRTDepositPoolABI from "./protocols/kelp/LRTDepositPoolABI.json";` Speaks for: lrtDepositPool.

- `addNodeDelegatorContractToQueue(address[] nodeDelegatorContracts)`
- `depositAsset(address asset, uint256 depositAmount, uint256 minRSETHAmountExpected, string referralId)`
- `depositETH(uint256 minRSETHAmountExpected, string referralId) payable`
- `getAssetCurrentLimit(address asset) view returns (uint256)`
- `getAssetDistributionData(address asset) view returns (uint256 assetLyingInDepositPool, uint256 assetLyingInNDCs, uint256 assetStakedInEigenLayer, uint256 assetUnstakingFromEigenLayer, uint256 assetLyingInConverter, uint256 assetLyingUnstakingVault)`
- `getETHDistributionData() view returns (uint256 ethLyingInDepositPool, uint256 ethLyingInNDCs, uint256 ethStakedInEigenLayer, uint256 ethUnstakingFromEigenLayer, uint256 ethLyingInConverter, uint256 ethLyingInUnstakingVault)`
- `getNodeDelegatorQueue() view returns (address[])`
- `getRsETHAmountToMint(address asset, uint256 amount) view returns (uint256 rsethAmountToMint)`
- `getSwapAssetForETHReturnAmount(address fromAsset, uint256 fromAssetAmount) view returns (uint256 returnAmount)`
- `getSwapETHToAssetReturnAmount(address toAsset, uint256 ethAmountToSend) view returns (uint256 returnAmount)`
- `getTotalAssetDeposits(address asset) view returns (uint256 totalAssetDeposit)`
- `initialize(address lrtConfigAddr)`
- `isNodeDelegator(address) view returns (uint256)`
- `lrtConfig() view returns (address)`
- `maxApproveToLRTConverter(address asset)`
- `maxNegligibleAmount() view returns (uint256)`
- `maxNodeDelegatorLimit() view returns (uint256)`
- `minAmountToDeposit() view returns (uint256)`
- `nodeDelegatorQueue(uint256) view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `receiveFromLRTConverter() payable`
- `receiveFromNodeDelegator() payable`
- `receiveFromRewardReceiver() payable`
- `removeManyNodeDelegatorContractsFromQueue(address[] nodeDelegatorContracts)`
- `removeNodeDelegatorContractFromQueue(address nodeDelegatorAddress)`
- `revokeApproveToLRTConverter(address asset)`
- `setMaxNegligibleAmount(uint256 maxNegligibleAmount_)`
- `setMinAmountToDeposit(uint256 minAmountToDeposit_)`
- `stakeEthForStETH(address referral, uint256 ethAmount)`
- `swapAssetForETHWithinDepositPool(address fromAsset, uint256 fromAssetAmount, uint256 minETHAmountExpected)`
- `swapETHForAssetWithinDepositPool(address toAsset, uint256 minToAssetAmount) payable`
- `transferAssetToLRTUnstakingVault(address asset, uint256 amount)`
- `transferAssetToNodeDelegator(uint256 ndcIndex, address asset, uint256 amount)`
- `transferETHToLRTUnstakingVault(uint256 amount)`
- `transferETHToNodeDelegator(uint256 ndcIndex, uint256 amount)`
- `unpause()`
- `updateMaxNodeDelegatorLimit(uint256 maxNodeDelegatorLimit_)`

### `RsETHABI`

`import RsETHABI from "./protocols/kelp/RsETHABI.json";` Speaks for: rsETH.

- `addPermanentExemptions(address[] accounts)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blockUserTransfers(address[] accounts)`
- `burnFrom(address account, uint256 amount)`
- `currentPeriodMintedAmount() view returns (uint256)`
- `custodyAddress() view returns (address)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `getCurrentPeriodStartTime() view returns (uint256)`
- `getNextDailyLimitResetTimestamp() view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address admin, address lrtConfigAddr)`
- `isPermanentlyExempt(address account) view returns (bool isExempt)`
- `lrtConfig() view returns (address)`
- `maxMintAmountPerDay() view returns (uint256)`
- `mint(address to, uint256 amount)`
- `name() view returns (string)`
- `pause()`
- `paused() view returns (bool)`
- `periodStartTime() view returns (uint256)`
- `recoverFrozenFunds(address from)`
- `reinitialize(uint256 _periodStartTime, address _custodyAddress)`
- `remainingDailyMintLimit() view returns (uint256)`
- `setCustodyAddress(address newCustodyAddress)`
- `setMaxMintAmountPerDay(uint256 _maxMintAmountPerDay)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transfersBlockedUntil(address account) view returns (uint256 blockedUntil)`
- `unpause()`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

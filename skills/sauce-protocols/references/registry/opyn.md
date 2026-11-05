<!-- Generated from the SDK's registries. Do not edit. -->

# Opyn (`opyn`)

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Opyn` on ethereum |
| Chains | ethereum |
| Document | [opyn.md](../opyn.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Opyn` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's controller, `0x64187ae08781B09368e6253F9E94951243A493D5`.
  require(Opyn.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |

## ABI

### `ControllerABI`

`import ControllerABI from "./protocols/opyn/ControllerABI.json";` Speaks for: controller. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Opyn` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `applyFunding()`
- `burnPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _withdrawAmount) returns (uint256 wPowerPerpAmount)`
- `burnWPowerPerpAmount(uint256 _vaultId, uint256 _wPowerPerpAmount, uint256 _withdrawAmount)`
- `deposit(uint256 _vaultId) payable`
- `depositUniPositionToken(uint256 _vaultId, uint256 _uniTokenId)`
- `donate() payable`
- `ethQuoteCurrencyPool() view returns (address)`
- `feeRate() view returns (uint256)`
- `feeRecipient() view returns (address)`
- `feeTier() view returns (uint24)`
- `FUNDING_PERIOD() view returns (uint256)`
- `getDenormalizedMark(uint32 _period) view returns (uint256)`
- `getDenormalizedMarkForFunding(uint32 _period) view returns (uint256)`
- `getExpectedNormalizationFactor() view returns (uint256)`
- `getIndex(uint32 _period) view returns (uint256)`
- `getUnscaledIndex(uint32 _period) view returns (uint256)`
- `indexForSettlement() view returns (uint256)`
- `isShutDown() view returns (bool)`
- `isSystemPaused() view returns (bool)`
- `isVaultSafe(uint256 _vaultId) view returns (bool)`
- `lastFundingUpdateTimestamp() view returns (uint128)`
- `lastPauseTime() view returns (uint256)`
- `liquidate(uint256 _vaultId, uint256 _maxDebtAmount) returns (uint256)`
- `mintPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _uniTokenId) payable returns (uint256, uint256)`
- `mintWPowerPerpAmount(uint256 _vaultId, uint256 _wPowerPerpAmount, uint256 _uniTokenId) payable returns (uint256)`
- `normalizationFactor() view returns (uint128)`
- `onERC721Received(address, address, uint256, bytes) returns (bytes4)`
- `oracle() view returns (address)`
- `owner() view returns (address)`
- `pause()`
- `pausesLeft() view returns (uint256)`
- `quoteCurrency() view returns (address)`
- `redeemLong(uint256 _wPerpAmount)`
- `redeemShort(uint256 _vaultId)`
- `reduceDebt(uint256 _vaultId)`
- `reduceDebtShutdown(uint256 _vaultId)`
- `renounceOwnership()`
- `setFeeRate(uint256 _newFeeRate)`
- `setFeeRecipient(address _newFeeRecipient)`
- `shortPowerPerp() view returns (address)`
- `shutDown()`
- `transferOwnership(address newOwner)`
- `TWAP_PERIOD() view returns (uint32)`
- `unPauseAnyone()`
- `unPauseOwner()`
- `updateOperator(uint256 _vaultId, address _operator)`
- `vaults(uint256) view returns (address operator, uint32 NftCollateralId, uint96 collateralAmount, uint128 shortAmount)`
- `weth() view returns (address)`
- `withdraw(uint256 _vaultId, uint256 _amount)`
- `withdrawUniPositionToken(uint256 _vaultId)`
- `wPowerPerp() view returns (address)`
- `wPowerPerpPool() view returns (address)`

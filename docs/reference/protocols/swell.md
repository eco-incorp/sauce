<!-- Generated from the SDK's registries. Do not edit. -->

# Swell (`swell`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Swell is a liquid staking protocol: stake a chain's coin and get back a token you can still use.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking via EigenLayer.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Swell` on ethereum |
| Chains | ethereum |

## What it offers

- **stakeSwETH**: Deposit ETH for swETH (liquid staking)
- **stakeRswETH**: Deposit ETH for rswETH (liquid restaking)

## Notes

- TVL: $800M+. Both tokens are non-rebasing (value accrues)
- swETH = standard liquid staking. rswETH = liquid restaking via EigenLayer
- Both deposit() functions are payable - send ETH as msg.value

## Its names in a program

On Ethereum, `Swell` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's rswETH, `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0`.
  require(Swell.RswETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `Swell.RswETH` |
| [Ethereum](../chains/ethereum.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `Swell.SwETH` |

## ABI

### `RswETHABI`

`import RswETHABI from "./protocols/swell/RswETHABI.json";` Speaks for: rswETH. The import is the contract's full ABI across every deployment; call it through the `Swell` namespace to have a function a chain's deployment does not run refused.

- `AccessControlManager() view returns (address)`
- `addToWhitelist(address _address)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `batchAddToWhitelist(address[] _addresses)`
- `batchRemoveFromWhitelist(address[] _addresses)`
- `burn(uint256 amount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit() payable`
- `depositViaDepositManager(uint256 _amount, address _to, uint256 _minRswETH)`
- `depositWithReferral(address referral) payable`
- `disableWhitelist()`
- `enableWhitelist()`
- `ethToRswETHRate() view returns (uint256)`
- `getRate() view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _accessControlManager)`
- `lastRepriceETHReserves() view returns (uint256)`
- `lastRepriceUNIX() view returns (uint256)`
- `maximumRepriceDifferencePercentage() view returns (uint256)`
- `maximumRepriceRswETHDifferencePercentage() view returns (uint256)`
- `minimumRepriceTime() view returns (uint256)`
- `name() view returns (string)`
- `nodeOperatorRewardPercentage() view returns (uint256)`
- `removeFromWhitelist(address _address)`
- `reprice(uint256 _preRewardETHReserves, uint256 _newETHRewards, uint256 _rswETHTotalSupply)`
- `rswETHToETHRate() view returns (uint256)`
- `setMaximumRepriceDifferencePercentage(uint256 _maximumRepriceDifferencePercentage)`
- `setMaximumRepriceRswETHDifferencePercentage(uint256 _maximumRepriceRswETHDifferencePercentage)`
- `setMinimumRepriceTime(uint256 _minimumRepriceTime)`
- `setNodeOperatorRewardPercentage(uint256 _newNodeOperatorRewardPercentage)`
- `setSwellTreasuryRewardPercentage(uint256 _newSwellTreasuryRewardPercentage)`
- `swellTreasuryRewardPercentage() view returns (uint256)`
- `symbol() view returns (string)`
- `totalETHDeposited() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `whitelistedAddresses(address) view returns (bool)`
- `whitelistEnabled() view returns (bool)`
- `withdrawERC20(address _token)`

Left out of this ABI, though its deployments declare them:

- `error CannotBeZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CannotBurnZeroRswETH` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMethodCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPreRewardETHReserves` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEnoughTimeElapsedForReprice` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInWhitelist` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NoTokensToWithdraw` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PRBMath_MulDiv_Overflow` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RepriceDifferenceTooLarge` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RepriceRswETHDifferenceTooLarge` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ETHWithdrawn` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `SwETHABI`

`import SwETHABI from "./protocols/swell/SwETHABI.json";` Speaks for: swETH. The import is the contract's full ABI across every deployment; call it through the `Swell` namespace to have a function a chain's deployment does not run refused.

- `AccessControlManager() view returns (address)`
- `addToWhitelist(address _address)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `batchAddToWhitelist(address[] _addresses)`
- `batchRemoveFromWhitelist(address[] _addresses)`
- `burn(uint256 amount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit() payable`
- `depositWithReferral(address referral) payable`
- `disableWhitelist()`
- `enableWhitelist()`
- `ethToSwETHRate() view returns (uint256)`
- `getRate() view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _accessControlManager)`
- `lastRepriceETHReserves() view returns (uint256)`
- `lastRepriceUNIX() view returns (uint256)`
- `maximumRepriceDifferencePercentage() view returns (uint256)`
- `maximumRepriceswETHDifferencePercentage() view returns (uint256)`
- `minimumRepriceTime() view returns (uint256)`
- `name() view returns (string)`
- `nodeOperatorRewardPercentage() view returns (uint256)`
- `removeFromWhitelist(address _address)`
- `reprice(uint256 _preRewardETHReserves, uint256 _newETHRewards, uint256 _swETHTotalSupply)`
- `setMaximumRepriceDifferencePercentage(uint256 _maximumRepriceDifferencePercentage)`
- `setMaximumRepriceswETHDifferencePercentage(uint256 _maximumRepriceswETHDifferencePercentage)`
- `setMinimumRepriceTime(uint256 _minimumRepriceTime)`
- `setNodeOperatorRewardPercentage(uint256 _newNodeOperatorRewardPercentage)`
- `setSwellTreasuryRewardPercentage(uint256 _newSwellTreasuryRewardPercentage)`
- `swellTreasuryRewardPercentage() view returns (uint256)`
- `swETHToETHRate() view returns (uint256)`
- `symbol() view returns (string)`
- `totalETHDeposited() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `whitelistedAddresses(address) view returns (bool)`
- `whitelistEnabled() view returns (bool)`
- `withdrawERC20(address _token)`

Left out of this ABI, though its deployments declare them:

- `error CannotBeZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CannotBurnZeroSwETH` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CannotRepriceWithZeroSwETHSupply` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMethodCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPreRewardETHReserves` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEnoughTimeElapsedForReprice` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInWhitelist` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NoTokensToWithdraw` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PRBMath_MulDiv_Overflow` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RepriceDifferenceTooLarge` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ETHWithdrawn` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

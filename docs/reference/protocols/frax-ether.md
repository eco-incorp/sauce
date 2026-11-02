<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Ether (`frax-ether`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Frax Ether is a liquid staking protocol: stake a chain's coin and get back a token you can still
> use. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Frax Finance's liquid staking derivative. Two tokens: frxETH (pegged 1:1 to ETH) and sfrxETH (yield-bearing ERC-4626 vault token that accrues staking yield).

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `FraxEther` on ethereum |
| Chains | ethereum |

## What it offers

- **submitAndDeposit**: Stake ETH and deposit directly into sfrxETH vault (one-step)
- **deposit**: Deposit frxETH into sfrxETH vault
- **redeem**: Redeem sfrxETH shares for frxETH

## Notes

- TVL: $700M+. sfrxETH is ERC-4626 compliant (same interface as Yearn V3, pufETH)
- submitAndDeposit() is payable - send ETH as msg.value. One-step ETH -> sfrxETH
- frxETH does not earn yield on its own - must be deposited into sfrxETH vault
- Approve frxETH to sfrxETH contract before calling deposit()

## Its names in a program

On Ethereum, `FraxEther` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's frxETHMinter, `0xbAFA44EFE7901E04E39Dad13167D089C559c1138`.
  require(FraxEther.FrxETHMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FraxEther.FrxETHMinter` |
| [Ethereum](../chains/ethereum.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `FraxEther.SfrxETH` |

## ABI

### `FrxETHMinterABI`

`import FrxETHMinterABI from "./protocols/frax-ether/FrxETHMinterABI.json";` Speaks for: frxETHMinter. The import is the contract's full ABI across every deployment; call it through the `FraxEther` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `activeValidators(bytes) view returns (bool)`
- `addValidator((bytes pubKey, bytes signature, bytes32 depositDataRoot) validator)`
- `addValidators((bytes pubKey, bytes signature, bytes32 depositDataRoot)[] validatorArray)`
- `clearValidatorArray()`
- `currentWithheldETH() view returns (uint256)`
- `DEPOSIT_SIZE() view returns (uint256)`
- `depositContract() view returns (address)`
- `depositEther(uint256 max_deposits)`
- `depositEtherPaused() view returns (bool)`
- `frxETHToken() view returns (address)`
- `getValidator(uint256 i) view returns (bytes pubKey, bytes withdrawalCredentials, bytes signature, bytes32 depositDataRoot)`
- `getValidatorStruct(bytes pubKey, bytes signature, bytes32 depositDataRoot) pure returns ((bytes pubKey, bytes signature, bytes32 depositDataRoot))`
- `moveWithheldETH(address to, uint256 amount)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address _owner)`
- `numValidators() view returns (uint256)`
- `owner() view returns (address)`
- `popValidators(uint256 times)`
- `RATIO_PRECISION() view returns (uint256)`
- `recoverERC20(address tokenAddress, uint256 tokenAmount)`
- `recoverEther(uint256 amount)`
- `removeValidator(uint256 remove_idx, bool dont_care_about_ordering)`
- `setTimelock(address _timelock_address)`
- `setWithdrawalCredential(bytes _new_withdrawal_pubkey)`
- `setWithholdRatio(uint256 newRatio)`
- `sfrxETHToken() view returns (address)`
- `submit() payable`
- `submitAndDeposit(address recipient) payable returns (uint256 shares)`
- `submitAndGive(address recipient) payable`
- `submitPaused() view returns (bool)`
- `swapValidator(uint256 from_idx, uint256 to_idx)`
- `timelock_address() view returns (address)`
- `togglePauseDepositEther()`
- `togglePauseSubmits()`
- `withholdRatio() view returns (uint256)`

### `SfrxETHABI`

`import SfrxETHABI from "./protocols/frax-ether/SfrxETHABI.json";` Speaks for: sfrxETH. The import is the contract's full ABI across every deployment; call it through the `FraxEther` namespace to have a function a chain's deployment does not run refused.

- `allowance(address, address) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `decimals() view returns (uint8)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `depositWithSignature(uint256 assets, address receiver, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 shares)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `lastRewardAmount() view returns (uint192)`
- `lastSync() view returns (uint32)`
- `maxDeposit(address) view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `mint(uint256 shares, address receiver) returns (uint256 assets)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `pricePerShare() view returns (uint256)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `rewardsCycleEnd() view returns (uint32)`
- `rewardsCycleLength() view returns (uint32)`
- `symbol() view returns (string)`
- `syncRewards()`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

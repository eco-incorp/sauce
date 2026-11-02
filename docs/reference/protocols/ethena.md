<!-- Generated from the SDK's registries. Do not edit. -->

# Ethena (`ethena`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Ethena is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Ethena` on ethereum |
| Chains | ethereum |

## What it offers

- **stakeUSDe**: Stake USDe to receive sUSDe (yield-bearing)
- **cooldownAssets**: Start cooldown period to unstake (by asset amount)
- **cooldownShares**: Start cooldown period to unstake (by share amount)
- **unstake**: Complete unstake after cooldown period

## Notes

- TVL: $3B+. Yield comes from ETH staking rewards + perpetual funding rates
- 7-day cooldown period required before unstaking
- Flow: deposit (stake) -> cooldownAssets/cooldownShares (start cooldown) -> unstake (after 7 days)
- Approve USDe to sUSDe contract before depositing
- sUSDe appreciates against USDe as yield accrues

## Its names in a program

On Ethereum, `Ethena` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's susde, `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`.
  require(Ethena.Susde != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethereum](../chains/ethereum.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | `Ethena.USDe` |

## ABI

### `StakedUSDeABI`

`import StakedUSDeABI from "./protocols/ethena/StakedUSDeABI.json";` Speaks for: susde. The import is the contract's full ABI across every deployment; call it through the `Ethena` namespace to have a function a chain's deployment does not run refused.

- `acceptAdmin()`
- `addToBlacklist(address target, bool isFullBlacklisting)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `cooldownAssets(uint256 assets) returns (uint256 shares)`
- `cooldownDuration() view returns (uint24)`
- `cooldowns(address) view returns (uint104 cooldownEnd, uint152 underlyingAmount)`
- `cooldownShares(uint256 shares) returns (uint256 assets)`
- `decimals() pure returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getUnvestedAmount() view returns (uint256)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `lastDistributionTimestamp() view returns (uint256)`
- `MAX_COOLDOWN_DURATION() view returns (uint24)`
- `maxDeposit(address) view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `mint(uint256 shares, address receiver) returns (uint256)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `redistributeLockedAmount(address from, address to)`
- `removeFromBlacklist(address target, bool isFullBlacklisting)`
- `renounceRole(bytes32, address)`
- `rescueTokens(address token, uint256 amount, address to)`
- `revokeRole(bytes32 role, address account)`
- `setCooldownDuration(uint24 duration)`
- `silo() view returns (address)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferAdmin(address newAdmin)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferInRewards(uint256 amount)`
- `unstake(address receiver)`
- `vestingAmount() view returns (uint256)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`

### `USDeABI`

`import USDeABI from "./protocols/ethena/USDeABI.json";` Speaks for: usde. The import is the contract's full ABI across every deployment; call it through the `Ethena` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 amount)`
- `burnFrom(address account, uint256 amount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `mint(address to, uint256 amount)`
- `minter() view returns (address)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `renounceOwnership() view`
- `setMinter(address newMinter)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

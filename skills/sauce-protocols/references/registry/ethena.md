<!-- Generated from the SDK's registries. Do not edit. -->

# Ethena (`ethena`)

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Ethena` on ethereum |
| Chains | ethereum |
| Document | [ethena.md](../ethena.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Ethena` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's susde, `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`.
  require(Ethena.Susde != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | `Ethena.USDe` |

## ABI

### `StakedUSDeABI`

`import StakedUSDeABI from "./protocols/ethena/StakedUSDeABI.json";` Speaks for: susde. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Ethena` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

Left out of this ABI, though its deployments declare them:

- `error InvalidZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `USDeABI`

`import USDeABI from "./protocols/ethena/USDeABI.json";` Speaks for: usde. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Ethena` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

Left out of this ABI, though its deployments declare them:

- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ZeroAddressException` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

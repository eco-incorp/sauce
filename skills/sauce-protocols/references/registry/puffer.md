<!-- Generated from the SDK's registries. Do not edit. -->

# Puffer Finance (`puffer`)

Liquid restaking protocol that issues pufETH. Deposits are natively restaked via EigenLayer for additional yield.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Puffer` on ethereum |
| Chains | ethereum |
| Document | [puffer.md](../puffer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Puffer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's pufETH, `0xD9A442856C234a39a81a089C06451EBAa4306a72`.
  require(Puffer.PufETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |

## ABI

### `PufferVaultABI`

`import PufferVaultABI from "./protocols/puffer/PufferVaultABI.json";` Speaks for: pufferVault.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 value) returns (bool)`
- `asset() view returns (address)`
- `authority() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 shares)`
- `claimWithdrawalsFromLido(uint256[] requestIds)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToSharesUp(uint256 assets) view returns (uint256)`
- `decimals() pure returns (uint8)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `depositETH(address receiver) payable returns (uint256)`
- `depositRewards() payable`
- `depositStETH(uint256 stETHSharesAmount, address receiver) returns (uint256)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `getExitFeeBasisPoints() view returns (uint256)`
- `getPendingLidoETHAmount() view returns (uint256)`
- `getTotalExitFeeBasisPoints() view returns (uint256)`
- `getTotalRewardDepositAmount() view returns (uint256)`
- `getTotalRewardMintAmount() view returns (uint256)`
- `getTreasury() view returns (address)`
- `getTreasuryExitFeeBasisPoints() view returns (uint96)`
- `initialize(address accessManager)`
- `initiateETHWithdrawalsFromLido(uint256[] amounts) returns (uint256[] requestIds)`
- `isConsumingScheduledOp() view returns (bytes4)`
- `maxDeposit(address) view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256 maxShares)`
- `maxWithdraw(address owner) view returns (uint256 maxAssets)`
- `mint(uint256 shares, address receiver) returns (uint256)`
- `mintRewards(uint256 rewardsAmount) returns (uint256 ethToPufETHRate, uint256 pufETHAmount)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `onERC721Received(address, address, uint256, bytes) returns (bytes4)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `proxiableUUID() view returns (bytes32)`
- `PUFFER_ORACLE() view returns (address)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `RESTAKING_REWARDS_DEPOSITOR() view returns (address)`
- `revertMintRewards(uint256 pufETHAmount, uint256 ethAmount)`
- `setAuthority(address newAuthority)`
- `setExitFeeBasisPoints(uint256 newExitFeeBasisPoints)`
- `setTreasuryExitFeeBasisPoints(uint96 newTreasuryExitFeeBasisPoints, address newTreasury)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 value) returns (bool)`
- `transferETH(address to, uint256 ethAmount)`
- `transferFrom(address from, address to, uint256 value) returns (bool)`
- `UPGRADE_INTERFACE_VERSION() view returns (string)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256)`

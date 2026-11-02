<!-- Generated from the SDK's registries. Do not edit. -->

# Stader (`stader`)

Multi-chain liquid staking protocol. ETHx is Stader's liquid staking token for Ethereum.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Stader` on ethereum |
| Chains | ethereum |
| Document | [stader.md](../stader.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Stader` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ETHx, `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b`.
  require(Stader.ETHx != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `Stader.ETHx` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `Stader.StakePoolManager` |

## ABI

### `ETHxABI`

`import ETHxABI from "./protocols/stader/ETHxABI.json";` Speaks for: ETHx.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `BURNER_ROLE() view returns (bytes32)`
- `burnFrom(address account, uint256 amount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _admin, address _staderConfig)`
- `mint(address to, uint256 amount)`
- `MINTER_ROLE() view returns (bytes32)`
- `name() view returns (string)`
- `pause()`
- `paused() view returns (bool)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `staderConfig() view returns (address)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `unpause()`
- `updateStaderConfig(address _staderConfig)`

### `StakePoolManagerABI`

`import StakePoolManagerABI from "./protocols/stader/StakePoolManagerABI.json";` Speaks for: stakePoolManager.

- `convertToAssets(uint256 _shares) view returns (uint256)`
- `convertToShares(uint256 _assets) view returns (uint256)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `deposit(address _receiver) payable returns (uint256)`
- `deposit(address _receiver, string _referralId) payable returns (uint256 _shares)`
- `depositETHOverTargetWeight()`
- `excessETHDepositCoolDown() view returns (uint256)`
- `getExchangeRate() view returns (uint256)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize(address _admin, address _staderConfig)`
- `isVaultHealthy() view returns (bool)`
- `lastExcessETHDepositBlock() view returns (uint256)`
- `maxDeposit() view returns (uint256)`
- `minDeposit() view returns (uint256)`
- `pause()`
- `paused() view returns (bool)`
- `previewDeposit(uint256 _assets) view returns (uint256)`
- `previewWithdraw(uint256 _shares) view returns (uint256)`
- `receiveEthFromAuction() payable`
- `receiveExcessEthFromPool(uint8 _poolId) payable`
- `receiveExecutionLayerRewards() payable`
- `receiveWithdrawVaultUserShare() payable`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `staderConfig() view returns (address)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `totalAssets() view returns (uint256)`
- `transferETHToUserWithdrawManager(uint256 _amount)`
- `unpause()`
- `updateExcessETHDepositCoolDown(uint256 _excessETHDepositCoolDown)`
- `updateStaderConfig(address _staderConfig)`
- `validatorBatchDeposit(uint8 _poolId)`

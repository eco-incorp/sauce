<!-- Generated from the SDK's registries. Do not edit. -->

# Renzo (`renzo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Renzo is a restaking protocol: staked coins put to work securing other services too. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a non-rebasing liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Renzo` on ethereum |
| Chains | ethereum |

## What it offers

- **depositETH**: Deposit ETH directly to receive ezETH
- **deposit**: Deposit LST collateral (stETH, etc.) to receive ezETH

## Notes

- TVL: $389M+. Built on EigenLayer restaking
- ezETH is non-rebasing - value accrues over time
- depositETH() is payable - send ETH as msg.value
- For LST deposits, approve the collateral token to restakeManager first

## Its names in a program

On Ethereum, `Renzo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ezETH, `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`.
  require(Renzo.EzETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Ethereum](../chains/ethereum.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |

## ABI

### `EzETHABI`

`import EzETHABI from "./protocols/renzo/EzETHABI.json";` Speaks for: ezETH.

- `_deprecated_paused() view returns (bool)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(address from, uint256 amount)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _roleManager)`
- `mint(address to, uint256 amount)`
- `name() view returns (string)`
- `roleManager() view returns (address)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`

### `RestakeManagerABI`

`import RestakeManagerABI from "./protocols/renzo/RestakeManagerABI.json";` Speaks for: restakeManager.

- `_deprecated_maxDepositTVL() view returns (uint256)`
- `addCollateralToken(address _newCollateralToken)`
- `addOperatorDelegator(address _newOperatorDelegator, uint256 _allocationBasisPoints)`
- `calculateTVLs() view returns (uint256[][], uint256[], uint256)`
- `chooseOperatorDelegatorForDeposit(uint256[] tvls, uint256 totalTVL) view returns (address)`
- `chooseOperatorDelegatorForWithdraw(uint256 tokenIndex, uint256 ezETHValue, uint256[][] operatorDelegatorTokenTVLs, uint256[] operatorDelegatorTVLs, uint256 totalTVL) view returns (address)`
- `collateralTokens(uint256) view returns (address)`
- `collateralTokenTvlLimits(address) view returns (uint256)`
- `delegationManager() view returns (address)`
- `deposit(address _collateralToken, uint256 _amount)`
- `deposit(address _collateralToken, uint256 _amount, uint256 _referralId)`
- `depositETH() payable`
- `depositETH(uint256 _referralId) payable`
- `depositQueue() view returns (address)`
- `depositTokenRewardsFromProtocol(address _token, uint256 _amount)`
- `ezETH() view returns (address)`
- `getCollateralTokenIndex(address _collateralToken) view returns (uint256)`
- `getCollateralTokensLength() view returns (uint256)`
- `getOperatorDelegatorsLength() view returns (uint256)`
- `initialize(address _roleManager, address _ezETH, address _renzoOracle, address _strategyManager, address _delegationManager, address _depositQueue)`
- `operatorDelegatorAllocations(address) view returns (uint256)`
- `operatorDelegators(uint256) view returns (address)`
- `paused() view returns (bool)`
- `pendingWithdrawals(bytes32) view returns (uint256 ezETHToBurn, address withdrawer, address tokenToWithdraw, uint256 tokenAmountToWithdraw, address operatorDelegator, bool completed)`
- `removeCollateralToken(address _collateralTokenToRemove)`
- `removeOperatorDelegator(address _operatorDelegatorToRemove)`
- `renzoOracle() view returns (address)`
- `riskOracleMiddleware() view returns (address)`
- `roleManager() view returns (address)`
- `setOperatorDelegatorAllocation(address _operatorDelegator, uint256 _allocationBasisPoints)`
- `setPaused(bool _paused)`
- `setTokenTvlLimit(address _token, uint256 _limit)`
- `stakeEthInOperatorDelegator(address operatorDelegator, bytes pubkey, bytes signature, bytes32 depositDataRoot) payable`
- `strategyManager() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

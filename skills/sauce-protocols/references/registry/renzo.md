<!-- Generated from the SDK's registries. Do not edit. -->

# Renzo (`renzo`)

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Renzo` on ethereum |
| Chains | ethereum |
| Document | [renzo.md](../renzo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Renzo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ezETH, `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`.
  require(Renzo.EzETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |

## ABI

### `EzETHABI`

`import EzETHABI from "./protocols/renzo/EzETHABI.json";` Speaks for: ezETH. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Renzo` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

Left out of this ABI, though its deployments declare them:

- `error NotEzETHMinterBurner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `RestakeManagerABI`

`import RestakeManagerABI from "./protocols/renzo/RestakeManagerABI.json";` Speaks for: restakeManager. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Renzo` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

Left out of this ABI, though its deployments declare them:

- `error InvalidTokenDecimals` taking `(uint8,uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTVL` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxTokenTVLReached` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotDepositQueue` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event UserWithdrawCompleted` taking `(bytes32,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event UserWithdrawStarted` taking `(bytes32,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

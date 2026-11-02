<!-- Generated from the SDK's registries. Do not edit. -->

# Euler V2 (`euler-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Euler V2 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Euler`: `euler-v2` |
| Namespace | `EulerV2` on ethereum |
| Chains | ethereum |

## Notes

- ERC-4626 compatible vault interface (deposit/withdraw/redeem)
- Must call `EVC.enableCollateral(account, collateralVault)` AND `EVC.enableController(account, borrowVault)` before borrowing
- Each EVault is a separate market with its own underlying asset and risk parameters
- Vaults are permissionlessly created -- always verify vault parameters before depositing
- Rebuilt from scratch after V1 exploit -- new architecture based on EVC
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `EulerV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ethereumVaultConnector, `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383`.
  require(EulerV2.EthereumVaultConnector != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ethereumVaultConnector | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` | `EulerV2.EthereumVaultConnector` |

## ABI

### `EVCABI`

`import EVCABI from "./protocols/euler-v2/EVCABI.json";` Speaks for: ethereumVaultConnector.

- `areChecksDeferred() view returns (bool)`
- `areChecksInProgress() view returns (bool)`
- `batch((address targetContract, address onBehalfOfAccount, uint256 value, bytes data)[] items) payable`
- `batchRevert((address targetContract, address onBehalfOfAccount, uint256 value, bytes data)[] items) payable`
- `batchSimulation((address targetContract, address onBehalfOfAccount, uint256 value, bytes data)[] items) payable returns ((bool success, bytes result)[] batchItemsResult, (address checkedAddress, bool isValid, bytes result)[] accountsStatusCheckResult, (address checkedAddress, bool isValid, bytes result)[] vaultsStatusCheckResult)`
- `call(address targetContract, address onBehalfOfAccount, uint256 value, bytes data) payable returns (bytes result)`
- `controlCollateral(address targetCollateral, address onBehalfOfAccount, uint256 value, bytes data) payable returns (bytes result)`
- `disableCollateral(address account, address vault) payable`
- `disableController(address account) payable`
- `enableCollateral(address account, address vault) payable`
- `enableController(address account, address vault) payable`
- `forgiveAccountStatusCheck(address account) payable`
- `forgiveVaultStatusCheck() payable`
- `getAccountOwner(address account) view returns (address)`
- `getAddressPrefix(address account) pure returns (bytes19)`
- `getCollaterals(address account) view returns (address[])`
- `getControllers(address account) view returns (address[])`
- `getCurrentOnBehalfOfAccount(address controllerToCheck) view returns (address onBehalfOfAccount, bool controllerEnabled)`
- `getLastAccountStatusCheckTimestamp(address account) view returns (uint256)`
- `getNonce(bytes19 addressPrefix, uint256 nonceNamespace) view returns (uint256)`
- `getOperator(bytes19 addressPrefix, address operator) view returns (uint256)`
- `getRawExecutionContext() view returns (uint256 context)`
- `haveCommonOwner(address account, address otherAccount) pure returns (bool)`
- `isAccountOperatorAuthorized(address account, address operator) view returns (bool)`
- `isAccountStatusCheckDeferred(address account) view returns (bool)`
- `isCollateralEnabled(address account, address vault) view returns (bool)`
- `isControlCollateralInProgress() view returns (bool)`
- `isControllerEnabled(address account, address vault) view returns (bool)`
- `isLockdownMode(bytes19 addressPrefix) view returns (bool)`
- `isOperatorAuthenticated() view returns (bool)`
- `isPermitDisabledMode(bytes19 addressPrefix) view returns (bool)`
- `isSimulationInProgress() view returns (bool)`
- `isVaultStatusCheckDeferred(address vault) view returns (bool)`
- `name() view returns (string)`
- `permit(address signer, address sender, uint256 nonceNamespace, uint256 nonce, uint256 deadline, uint256 value, bytes data, bytes signature) payable`
- `reorderCollaterals(address account, uint8 index1, uint8 index2) payable`
- `requireAccountAndVaultStatusCheck(address account) payable`
- `requireAccountStatusCheck(address account) payable`
- `requireVaultStatusCheck() payable`
- `setAccountOperator(address account, address operator, bool authorized) payable`
- `setLockdownMode(bytes19 addressPrefix, bool enabled) payable`
- `setNonce(bytes19 addressPrefix, uint256 nonceNamespace, uint256 nonce) payable`
- `setOperator(bytes19 addressPrefix, address operator, uint256 operatorBitField) payable`
- `setPermitDisabledMode(bytes19 addressPrefix, bool enabled) payable`

### `EVaultABI`

`import EVaultABI from "./protocols/euler-v2/EVaultABI.json";`

- `accountLiquidity(address account, bool liquidation) view returns (uint256 collateralValue, uint256 liabilityValue)`
- `accountLiquidityFull(address account, bool liquidation) view returns (address[] collaterals, uint256[] collateralValues, uint256 liabilityValue)`
- `accumulatedFees() view returns (uint256)`
- `accumulatedFeesAssets() view returns (uint256)`
- `allowance(address holder, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`
- `balanceForwarderEnabled(address account) view returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `balanceTrackerAddress() view returns (address)`
- `borrow(uint256 amount, address receiver) returns (uint256 shares)`
- `caps() view returns (uint16 supplyCap, uint16 borrowCap)`
- `cash() view returns (uint256)`
- `checkAccountStatus(address account, address[] collaterals) view returns (bytes4)`
- `checkLiquidation(address liquidator, address violator, address collateral) view returns (uint256 maxRepay, uint256 maxYield)`
- `checkVaultStatus() returns (bytes4)`
- `configFlags() view returns (uint32)`
- `convertFees()`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `creator() view returns (address)`
- `debtOf(address account) view returns (uint256)`
- `debtOfExact(address account) view returns (uint256)`
- `decimals() view returns (uint8)`
- `deposit(uint256 amount, address receiver) returns (uint256 shares)`
- `disableBalanceForwarder()`
- `disableController()`
- `dToken() view returns (address)`
- `enableBalanceForwarder()`
- `EVC() view returns (address)`
- `feeReceiver() view returns (address)`
- `flashLoan(uint256 amount, bytes data)`
- `governorAdmin() view returns (address)`
- `hookConfig() view returns (address, uint32)`
- `initialize(address proxyCreator)`
- `interestAccumulator() view returns (uint256)`
- `interestFee() view returns (uint16)`
- `interestRate() view returns (uint256)`
- `interestRateModel() view returns (address)`
- `liquidate(address violator, address collateral, uint256 repayAssets, uint256 minYieldBalance)`
- `liquidationCoolOffTime() view returns (uint16)`
- `LTVBorrow(address collateral) view returns (uint16)`
- `LTVFull(address collateral) view returns (uint16 borrowLTV, uint16 liquidationLTV, uint16 initialLiquidationLTV, uint48 targetTimestamp, uint32 rampDuration)`
- `LTVLiquidation(address collateral) view returns (uint16)`
- `LTVList() view returns (address[])`
- `maxDeposit(address account) view returns (uint256)`
- `maxLiquidationDiscount() view returns (uint16)`
- `maxMint(address account) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `mint(uint256 amount, address receiver) returns (uint256)`
- `MODULE_BALANCE_FORWARDER() view returns (address)`
- `MODULE_BORROWING() view returns (address)`
- `MODULE_GOVERNANCE() view returns (address)`
- `MODULE_INITIALIZE() view returns (address)`
- `MODULE_LIQUIDATION() view returns (address)`
- `MODULE_RISKMANAGER() view returns (address)`
- `MODULE_TOKEN() view returns (address)`
- `MODULE_VAULT() view returns (address)`
- `name() view returns (string)`
- `oracle() view returns (address)`
- `permit2Address() view returns (address)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `protocolConfigAddress() view returns (address)`
- `protocolFeeReceiver() view returns (address)`
- `protocolFeeShare() view returns (uint256)`
- `pullDebt(uint256 amount, address from)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 amount)`
- `repay(uint256 amount, address receiver) returns (uint256 shares)`
- `repayWithShares(uint256 amount, address receiver) returns (uint256 shares, uint256 debt)`
- `setCaps(uint16 supplyCap, uint16 borrowCap)`
- `setConfigFlags(uint32 newConfigFlags)`
- `setFeeReceiver(address newFeeReceiver)`
- `setGovernorAdmin(address newGovernorAdmin)`
- `setHookConfig(address newHookTarget, uint32 newHookedOps)`
- `setInterestFee(uint16 newFee)`
- `setInterestRateModel(address newModel)`
- `setLiquidationCoolOffTime(uint16 newCoolOffTime)`
- `setLTV(address collateral, uint16 borrowLTV, uint16 liquidationLTV, uint32 rampDuration)`
- `setMaxLiquidationDiscount(uint16 newDiscount)`
- `skim(uint256 amount, address receiver) returns (uint256)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalBorrows() view returns (uint256)`
- `totalBorrowsExact() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `touch()`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferFromMax(address from, address to) returns (bool)`
- `unitOfAccount() view returns (address)`
- `viewDelegate() payable`
- `withdraw(uint256 amount, address receiver, address owner) returns (uint256 shares)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

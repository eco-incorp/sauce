<!-- Generated from the SDK's registries. Do not edit. -->

# Lido (`lido`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Lido is a liquid staking protocol: stake a chain's coin and get back a token you can still use.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Liquid staking protocol for Ethereum. Stake ETH and receive stETH, a rebasing liquid staking token. wstETH is the non-rebasing wrapped version for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Lido` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## What it offers

- **submit**: Stake ETH and receive stETH (rebasing)
- **wrap**: Wrap stETH into wstETH (non-rebasing, DeFi-compatible)
- **unwrap**: Unwrap wstETH back to stETH

## Notes

- TVL: $27.5B+
- stETH rebases daily (balance increases). wstETH does not rebase (exchange rate increases instead)
- Always use wstETH for DeFi integrations (Aave, Uniswap, etc.) since rebasing tokens cause issues
- submit() requires ETH sent as msg.value. The referral parameter can be zero address
- Approve stETH to wstETH contract before calling wrap()
- On Arbitrum, wstETH is the bridged token, `Lido.WstETHBridged` (`WstETHBridgedABI`): an ERC-20 (`balanceOf`, `transfer`, `approve`) with no `wrap`, `unwrap`, `getStETHByWstETH` or `getWstETHByStETH`, each of which reverts there. Wrap, unwrap and read the stETH rate on Ethereum, through `Lido.WstETH`

## Its names in a program

On Ethereum, `Lido` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's stETH, `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`.
  require(Lido.StETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Ethereum](../chains/ethereum.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [Arbitrum One](../chains/arbitrum.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `Lido.WstETHBridged` |

## ABI

### `LidoABI`

`import LidoABI from "./protocols/lido/LidoABI.json";` Speaks for: stETH. The import is the contract's full ABI across every deployment; call it through the `Lido` namespace to have a function a chain's deployment does not run refused.

- `allowance(address _owner, address _spender) view returns (uint256)`
- `allowRecoverability(address token) view returns (bool)`
- `appId() view returns (bytes32)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `BUFFER_RESERVE_MANAGER_ROLE() view returns (bytes32)`
- `burnExternalShares(uint256 _amountOfShares)`
- `burnShares(uint256 _amountOfShares)`
- `canDeposit() view returns (bool)`
- `canPerform(address _sender, bytes32 _role, uint256[] _params) view returns (bool)`
- `collectRewardsAndProcessWithdrawals(uint256 _reportTimestamp, uint256 _reportClBalance, uint256 _principalCLBalance, uint256 _withdrawalsToWithdraw, uint256 _elRewardsToWithdraw, uint256 _lastWithdrawalRequestToFinalize, uint256 _withdrawalsShareRate, uint256 _etherToLockOnWithdrawalQueue)`
- `decimals() pure returns (uint8)`
- `decreaseAllowance(address _spender, uint256 _subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (string name, string version, uint256 chainId, address verifyingContract)`
- `emitTokenRebase(uint256 _reportTimestamp, uint256 _timeElapsed, uint256 _preTotalShares, uint256 _preTotalEther, uint256 _postTotalShares, uint256 _postTotalEther, uint256 _postInternalShares, uint256 _postInternalEther, uint256 _sharesMintedAsFees)`
- `finalizeUpgrade_v4(uint256 _depositsReserveTarget)`
- `getBalanceStats() view returns (uint256 clValidatorsBalanceAtLastReport, uint256 clPendingBalanceAtLastReport, uint256 depositedSinceLastReport, uint256 depositedForCurrentReport)`
- `getBeaconStat() view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance)`
- `getBufferedEther() view returns (uint256)`
- `getContractVersion() view returns (uint256)`
- `getCurrentStakeLimit() view returns (uint256)`
- `getDepositableEther() view returns (uint256)`
- `getDepositsReserve() view returns (uint256 depositsReserve)`
- `getDepositsReserveTarget() view returns (uint256)`
- `getEIP712StETH() view returns (address)`
- `getEVMScriptExecutor(bytes _script) view returns (address)`
- `getEVMScriptRegistry() view returns (address)`
- `getExternalEther() view returns (uint256)`
- `getExternalShares() view returns (uint256)`
- `getFee() view returns (uint16 totalFee)`
- `getFeeDistribution() view returns (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, uint16 operatorsFeeBasisPoints)`
- `getInitializationBlock() view returns (uint256)`
- `getLidoLocator() view returns (address)`
- `getMaxExternalRatioBP() view returns (uint256)`
- `getMaxMintableExternalShares() view returns (uint256)`
- `getPooledEthByShares(uint256 _sharesAmount) view returns (uint256)`
- `getPooledEthBySharesRoundUp(uint256 _sharesAmount) view returns (uint256)`
- `getRecoveryVault() view returns (address)`
- `getSharesByPooledEth(uint256 _ethAmount) view returns (uint256)`
- `getStakeLimitFullInfo() view returns (bool isStakingPaused_, bool isStakingLimitSet, uint256 currentStakeLimit, uint256 maxStakeLimit, uint256 maxStakeLimitGrowthBlocks, uint256 prevStakeLimit, uint256 prevStakeBlockNumber)`
- `getTotalELRewardsCollected() view returns (uint256)`
- `getTotalPooledEther() view returns (uint256)`
- `getTotalShares() view returns (uint256)`
- `getTreasury() view returns (address)`
- `getWithdrawalCredentials() view returns (bytes32)`
- `getWithdrawalsReserve() view returns (uint256)`
- `hasInitialized() view returns (bool)`
- `increaseAllowance(address _spender, uint256 _addedValue) returns (bool)`
- `initialize(address _lidoLocator, address _eip712StETH, uint256 _depositsReserveTarget) payable`
- `internalizeExternalBadDebt(uint256 _amountOfShares)`
- `isPetrified() view returns (bool)`
- `isStakingPaused() view returns (bool)`
- `isStopped() view returns (bool)`
- `kernel() view returns (address)`
- `mintExternalShares(address _recipient, uint256 _amountOfShares)`
- `mintShares(address _recipient, uint256 _amountOfShares)`
- `name() pure returns (string)`
- `nonces(address owner) view returns (uint256)`
- `PAUSE_ROLE() view returns (bytes32)`
- `pauseStaking()`
- `permit(address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s)`
- `processClStateUpdate(uint256 _reportTimestamp, uint256 _clValidatorsBalance, uint256 _clPendingBalance)`
- `rebalanceExternalEtherToInternal(uint256 _amountOfShares) payable`
- `receiveELRewards() payable`
- `receiveWithdrawals() payable`
- `removeStakingLimit()`
- `resume()`
- `RESUME_ROLE() view returns (bytes32)`
- `resumeStaking()`
- `setDepositsReserveTarget(uint256 _newDepositsReserveTarget)`
- `setMaxExternalRatioBP(uint256 _maxExternalRatioBP)`
- `setStakingLimit(uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock)`
- `sharesOf(address _account) view returns (uint256)`
- `STAKING_CONTROL_ROLE() view returns (bytes32)`
- `STAKING_PAUSE_ROLE() view returns (bytes32)`
- `stop()`
- `submit(address _referral) payable returns (uint256)`
- `symbol() pure returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address _recipient, uint256 _amount) returns (bool)`
- `transferFrom(address _sender, address _recipient, uint256 _amount) returns (bool)`
- `transferShares(address _recipient, uint256 _sharesAmount) returns (uint256)`
- `transferSharesFrom(address _sender, address _recipient, uint256 _sharesAmount) returns (uint256)`
- `transferToVault(address)`
- `withdrawDepositableEther(uint256 _amount, uint256 _seedDepositsCount)`

### `WstETHABI`

`import WstETHABI from "./protocols/lido/WstETHABI.json";` Speaks for: wstETH. The import is the contract's full ABI across every deployment; call it through the `Lido` namespace to have a function a chain's deployment does not run refused.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)`
- `getWstETHByStETH(uint256 _stETHAmount) view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `stETH() view returns (address)`
- `stEthPerToken() view returns (uint256)`
- `symbol() view returns (string)`
- `tokensPerStEth() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address recipient, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `unwrap(uint256 _wstETHAmount) returns (uint256)`
- `wrap(uint256 _stETHAmount) returns (uint256)`

### `WstETHBridgedABI`

`import WstETHBridgedABI from "./protocols/lido/WstETHBridgedABI.json";` Speaks for: wstETH. The import is the contract's full ABI across every deployment; call it through the `Lido` namespace to have a function a chain's deployment does not run refused.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `bridge() view returns (address)`
- `bridgeBurn(address account_, uint256 amount_)`
- `bridgeMint(address account_, uint256 amount_)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(string name_, string symbol_)`
- `name() view returns (string)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

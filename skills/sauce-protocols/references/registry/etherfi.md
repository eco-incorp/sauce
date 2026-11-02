<!-- Generated from the SDK's registries. Do not edit. -->

# ether.fi (`etherfi`)

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH, or wrap it as weETH for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Etherfi` on ethereum |
| Chains | ethereum |
| Document | [etherfi.md](../etherfi.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Etherfi` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's eETH, `0x35fA164735182de50811E8e2E824cFb9B6118ac2`.
  require(Etherfi.EETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `Etherfi.EETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `Etherfi.LiquidityPool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `Etherfi.WeETH` |

## ABI

### `EETHABI`

`import EETHABI from "./protocols/etherfi/EETHABI.json";` Speaks for: eETH. The import is the contract's full ABI across every deployment; call it through the `Etherfi` namespace to have a function a chain's deployment does not run refused.

- `allowance(address _owner, address _spender) view returns (uint256)`
- `allowances(address, address) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blacklister() view returns (address)`
- `burnShares(address _user, uint256 _share)`
- `decimals() pure returns (uint8)`
- `decreaseAllowance(address _spender, uint256 _decreaseAmount) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `EETH_BURN_LIMIT_ID() view returns (bytes32)`
- `EETH_MINT_LIMIT_ID() view returns (bytes32)`
- `getImplementation() view returns (address)`
- `increaseAllowance(address _spender, uint256 _increaseAmount) returns (bool)`
- `initialize()`
- `lastPauseTimestamp(address pauser) view returns (uint256)`
- `liquidityPool() view returns (address)`
- `MAX_PAUSE_DURATION() view returns (uint256)`
- `MIN_PAUSE_DURATION() view returns (uint256)`
- `mintShares(address _user, uint256 _share)`
- `name() pure returns (string)`
- `nonces(address owner) view returns (uint256)`
- `pause()`
- `paused() view returns (bool)`
- `pausedUntil() view returns (uint256)`
- `PAUSER_UNTIL_COOLDOWN() view returns (uint256)`
- `pauseUntil()`
- `pauseUntilDuration() view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `proxiableUUID() view returns (bytes32)`
- `rateLimiter() view returns (address)`
- `recoverERC20(address token, address to, uint256 amount)`
- `recoverERC721(address token, address to, uint256 tokenId)`
- `recoverETH(address to, uint256 amount)`
- `roleRegistry() view returns (address)`
- `setPauseUntilDuration(uint256 _pauseUntilDuration)`
- `shares(address) view returns (uint256)`
- `symbol() pure returns (string)`
- `totalShares() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address _recipient, uint256 _amount) returns (bool)`
- `transferFrom(address _sender, address _recipient, uint256 _amount) returns (bool)`
- `unpause()`
- `unpauseUntil()`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`

Left out of this ABI, though its deployments declare them:

- `error InsufficientBalance` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Reentrancy` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/etherfi/LiquidityPoolABI.json";` Speaks for: liquidityPool. The import is the contract's full ABI across every deployment; call it through the `Etherfi` namespace to have a function a chain's deployment does not run refused.

- `addEthAmountLockedForWithdrawal(uint128 _amount)`
- `amountForShare(uint256 _share) view returns (uint256)`
- `amountPerShareCeil() view returns (uint256)`
- `batchCreateBeaconValidators((bytes publicKey, bytes signature, bytes32 depositDataRoot, string ipfsHashForEncryptedValidatorKey)[] _depositData, uint256[] _bidIds, address _etherFiNode)`
- `batchRegister((bytes publicKey, bytes signature, bytes32 depositDataRoot, string ipfsHashForEncryptedValidatorKey)[] _depositData, uint256[] _bidIds, address _etherFiNode)`
- `blacklister() view returns (address)`
- `burnEEthShares(uint256 shares)`
- `burnEEthSharesForNonETHWithdrawal(uint256 _amountSharesToBurn, uint256 _withdrawalValueInETH)`
- `confirmAndFundBeaconValidators((bytes publicKey, bytes signature, bytes32 depositDataRoot, string ipfsHashForEncryptedValidatorKey)[] _depositData, uint256 _validatorSizeWei)`
- `deposit() payable returns (uint256)`
- `deposit(address _referral) payable returns (uint256)`
- `deposit(address _user, address _referral) payable returns (uint256)`
- `depositToRecipient(address _recipient, uint256 _amount, address _referral) returns (uint256)`
- `eETH() view returns (address)`
- `escrowMigrationCompleted() view returns (bool)`
- `etherFiAdminContract() view returns (address)`
- `etherFiRedemptionManager() view returns (address)`
- `feeRecipient() view returns (address)`
- `getImplementation() view returns (address)`
- `getTotalEtherClaimOf(address _user) view returns (uint256)`
- `getTotalPooledEther() view returns (uint256)`
- `initialize()`
- `initializeOnUpgradeV2()`
- `lastPauseTimestamp(address pauser) view returns (uint256)`
- `liquifier() view returns (address)`
- `MAX_PAUSE_DURATION() view returns (uint256)`
- `MAX_POSITIVE_REBASE_BPS() view returns (uint256)`
- `maxWithdrawAmount() view returns (uint256)`
- `membershipManager() view returns (address)`
- `MIN_PAUSE_DURATION() view returns (uint256)`
- `minWithdrawAmount() view returns (uint256)`
- `nodesManager() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pausedUntil() view returns (uint256)`
- `PAUSER_UNTIL_COOLDOWN() view returns (uint256)`
- `pauseUntil()`
- `pauseUntilDuration() view returns (uint256)`
- `priorityWithdrawalQueue() view returns (address)`
- `proxiableUUID() view returns (bytes32)`
- `rebase(int128 _accruedRewards, uint128 _protocolFees)`
- `registerValidatorSpawner(address _user)`
- `requestMembershipNFTWithdraw(address recipient, uint256 amount, uint256 fee) returns (uint256)`
- `requestWithdraw(address recipient, uint256 amount) returns (uint256)`
- `requestWithdrawWithPermit(address _owner, uint256 _amount, (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) _permit) returns (uint256)`
- `roleRegistry() view returns (address)`
- `setFeeRecipient(address _feeRecipient)`
- `setMaxWithdrawAmount(uint256 _maxWithdrawAmount)`
- `setMinWithdrawAmount(uint256 _minWithdrawAmount)`
- `setPauseUntilDuration(uint256 _pauseUntilDuration)`
- `setValidatorSizeWei(uint256 _validatorSizeWei)`
- `SHARE_UNIT() view returns (uint256)`
- `sharesForAmount(uint256 _amount) view returns (uint256)`
- `sharesForWithdrawalAmount(uint256 _amount) view returns (uint256)`
- `stakingManager() view returns (address)`
- `totalValueInLp() view returns (uint128)`
- `totalValueOutOfLp() view returns (uint128)`
- `transferLockedEthForPriority(uint128 _amount)`
- `unpause()`
- `unpauseUntil()`
- `unregisterValidatorSpawner(address _user)`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `validatorSizeWei() view returns (uint256)`
- `validatorSpawner(address) view returns (bool registered)`
- `withdraw(address _recipient, uint256 _amount) returns (uint256)`
- `withdrawRequestNFT() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `error InvalidAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Reentrancy` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `withdraw` taking `(uint256,uint256)`: an overload of withdraw(address,uint256), which takes as many arguments: a call picks its overload by argument count.

### `WeETHABI`

`import WeETHABI from "./protocols/etherfi/WeETHABI.json";` Speaks for: weETH. The import is the contract's full ABI across every deployment; call it through the `Etherfi` namespace to have a function a chain's deployment does not run refused.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blacklister() view returns (address)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eETH() view returns (address)`
- `getEETHByWeETH(uint256 _weETHAmount) view returns (uint256)`
- `getImplementation() view returns (address)`
- `getRate() view returns (uint256)`
- `getWeETHByeETH(uint256 _eETHAmount) view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize()`
- `lastPauseTimestamp(address pauser) view returns (uint256)`
- `liquidityPool() view returns (address)`
- `MAX_PAUSE_DURATION() view returns (uint256)`
- `MIN_PAUSE_DURATION() view returns (uint256)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `pause()`
- `paused() view returns (bool)`
- `pausedUntil() view returns (uint256)`
- `PAUSER_UNTIL_COOLDOWN() view returns (uint256)`
- `pauseUntil()`
- `pauseUntilDuration() view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `proxiableUUID() view returns (bytes32)`
- `recoverERC20(address token, address to, uint256 amount)`
- `recoverERC721(address token, address to, uint256 tokenId)`
- `recoverETH(address to, uint256 amount)`
- `roleRegistry() view returns (address)`
- `setPauseUntilDuration(uint256 _pauseUntilDuration)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `unpause()`
- `unpauseUntil()`
- `unwrap(uint256 _weETHAmount) returns (uint256)`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `wrap(uint256 _eETHAmount) returns (uint256)`
- `wrapWithPermit(uint256 _eETHAmount, (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) _permit) returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `error InsufficientBalance` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Reentrancy` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

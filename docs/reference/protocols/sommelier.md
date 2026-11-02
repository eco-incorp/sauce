<!-- Generated from the SDK's registries. Do not edit. -->

# Sommelier (`sommelier`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Sommelier is a yield vault: deposits are put to work to earn interest. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Sommelier` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## Notes

- Cellars are ERC-4626 vaults. Strategies managed off-chain via Cosmos governance.

## Its names in a program

On Ethereum, `Sommelier` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cellarRouter, `0x1D90366B0154fBcB5101c06a39c25D26cB48e889`.
  require(Sommelier.CellarRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cellarRouter | `0x1D90366B0154fBcB5101c06a39c25D26cB48e889` | `Sommelier.CellarRouter` |

## ABI

### `CellarABI`

`import CellarABI from "./protocols/sommelier/CellarABI.json";`

- `aavePool() view returns (address)`
- `addPosition(uint32 index, uint32 positionId, bytes configurationData, bool inDebtArray)`
- `allowance(address, address) view returns (uint256)`
- `allowedRebalanceDeviation() view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`
- `assetRiskTolerance() view returns (uint128)`
- `balanceOf(address) view returns (uint256)`
- `blockExternalReceiver() view returns (bool)`
- `callOnAdaptor((address adaptor, bytes[] callData)[] data)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `creditPositions(uint256) view returns (uint32)`
- `debtPositions(uint256) view returns (uint32)`
- `decimals() view returns (uint8)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `executeOperation(address[] assets, uint256[] amounts, uint256[] premiums, address initiator, bytes params) returns (bool)`
- `feeData() view returns (uint64 strategistPlatformCut, uint64 platformFee, uint64 lastAccrual, address strategistPayoutAddress)`
- `getCreditPositions() view returns (uint32[])`
- `getDebtPositions() view returns (uint32[])`
- `getPositionAssets() view returns (address[] assets)`
- `getPositionData(uint32) view returns (address adaptor, bool isDebt, bytes adaptorData, bytes configurationData)`
- `GRAVITY_BRIDGE_REGISTRY_SLOT() view returns (uint256)`
- `holdingPosition() view returns (uint32)`
- `initialize(bytes params)`
- `initiateShutdown()`
- `isAdaptorSetup(address) view returns (bool)`
- `isPositionUsed(uint256) view returns (bool)`
- `isShutdown() view returns (bool)`
- `liftShutdown()`
- `locked() view returns (uint256)`
- `MAX_FEE_CUT() view returns (uint64)`
- `MAX_PLATFORM_FEE() view returns (uint64)`
- `MAX_POSITIONS() view returns (uint256)`
- `MAX_REBALANCE_DEVIATION() view returns (uint64)`
- `maxDeposit(address) view returns (uint256)`
- `MAXIMUM_SHARE_LOCK_PERIOD() view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `MINIMUM_SHARE_LOCK_PERIOD() view returns (uint256)`
- `mint(uint256 shares, address receiver) returns (uint256 assets)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `onERC721Received(address, address, uint256, bytes) returns (bytes4)`
- `owner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets) view returns (uint256 shares)`
- `previewMint(uint256 shares) view returns (uint256 assets)`
- `previewRedeem(uint256 shares) view returns (uint256 assets)`
- `previewWithdraw(uint256 assets) view returns (uint256 shares)`
- `PRICE_ROUTER_REGISTRY_SLOT() view returns (uint256)`
- `protocolRiskTolerance() view returns (uint128)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `registry() view returns (address)`
- `removePosition(uint32 index, bool inDebtArray)`
- `sendFees()`
- `setHoldingPosition(uint32 positionId)`
- `setPlatformFee(uint64 newPlatformFee)`
- `setRebalanceDeviation(uint256 newDeviation)`
- `setShareLockPeriod(uint256 newLock)`
- `setStrategistPayoutAddress(address payout)`
- `setStrategistPlatformCut(uint64 cut)`
- `setupAdaptor(address _adaptor)`
- `shareLockPeriod() view returns (uint256)`
- `swapPositions(uint32 index1, uint32 index2, bool inDebtArray)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalAssetsWithdrawable() view returns (uint256 assets)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `userShareLockStartTime(address) view returns (uint256)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`

Left out of this ABI, though its deployments declare them:

- `error Cellar__AdaptorNotSetUp` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__AssetMismatch` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__ContractShutdown` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__DebtMismatch` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__DepositRestricted` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__ExternalInitiator` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__IlliquidWithdraw` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__InvalidFee` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__InvalidHoldingPosition` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__InvalidRebalanceDeviation` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__InvalidShareLockPeriod` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__NotApprovedToDepositOnBehalf` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__PositionAlreadyUsed` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__PositionNotEmpty` taking `(uint32,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__RemovingHoldingPosition` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__SharesAreLocked` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__TotalAssetDeviatedOutsideRange` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__TotalSharesMustRemainConstant` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Cellar__ZeroShares` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

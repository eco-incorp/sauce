<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Premia is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Premia` on arbitrum |
| Chains | arbitrum |

## What it offers

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

## Notes

- Each pool is a proxy routed through the pool Diamond's facets
- Supports calls and puts on ETH, BTC, and other assets
- Long token = bought option, short token = sold/written option
- exercise returns the in-the-money value; settle returns remaining collateral to writers

## Its names in a program

On Arbitrum One, `Premia` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's poolFactory, `0xAE4fB6622F25f397587F11638dA8CE88C27b5645`.
  require(Premia.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | `Premia.PoolFactory` |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/premia/DiamondABI.json";`

- `_takerFeeLowLevel(address taker, uint256 size, uint256 premium, bool isPremiumNormalized, bool isOrderbook, uint256 strike, bool isCallPool) view returns (uint256)`
- `acceptOwnership()`
- `accountsByToken(uint256 id) view returns (address[])`
- `annihilate(uint256 size)`
- `annihilateFor(address account, uint256 size)`
- `balanceOf(address account, uint256 id) view returns (uint256)`
- `balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])`
- `cancelQuotesOB(bytes32[] hashes)`
- `claim((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p) returns (uint256)`
- `deposit((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p, uint256 belowLower, uint256 belowUpper, uint256 size, uint256 minMarketPrice, uint256 maxMarketPrice) returns ((int256 collateral, int256 longs, int256 shorts) delta)`
- `deposit((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p, uint256 belowLower, uint256 belowUpper, uint256 size, uint256 minMarketPrice, uint256 maxMarketPrice, bool isBidIfStrandedMarketPrice) returns ((int256 collateral, int256 longs, int256 shorts) delta)`
- `diamondCut((address target, uint8 action, bytes4[] selectors)[] facetCuts, address target, bytes data)`
- `exercise() returns (uint256 exerciseValue, uint256 exerciseFee)`
- `exerciseFor(address[] holders, uint256 costPerHolder) returns (uint256[] exerciseValues, uint256[] exerciseFees)`
- `facetAddress(bytes4 selector) view returns (address facet)`
- `facetAddresses() view returns (address[] addresses)`
- `facetFunctionSelectors(address facet) view returns (bytes4[] selectors)`
- `facets() view returns ((address target, bytes4[] selectors)[] diamondFacets)`
- `fillQuoteOB((address provider, address taker, uint256 price, uint256 size, bool isBuy, uint256 deadline, uint256 salt) quoteOB, uint256 size, (uint8 v, bytes32 r, bytes32 s) signature, address referrer) returns (uint256 premiumTaker, (int256 collateral, int256 longs, int256 shorts) delta)`
- `flashFee(address token, uint256 amount) view returns (uint256)`
- `flashLoan(address receiver, address token, uint256 amount, bytes data) returns (bool)`
- `getClaimableFees((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p) view returns (uint256)`
- `getFallbackAddress() view returns (address fallbackAddress)`
- `getNearestTicksBelow(uint256 lower, uint256 upper) view returns (uint256 nearestBelowLower, uint256 nearestBelowUpper)`
- `getPoolSettings() view returns (address base, address quote, address oracleAdapter, uint256 strike, uint256 maturity, bool isCallPool)`
- `getQuoteAMM(address taker, uint256 size, bool isBuy) view returns (uint256 premiumNet, uint256 takerFee)`
- `getQuoteOBFilledAmount(address provider, bytes32 quoteOBHash) view returns (uint256)`
- `getSettlementPrice() view returns (uint256)`
- `getStrandedArea() view returns (uint256 lower, uint256 upper)`
- `getTokenIds() view returns (uint256[])`
- `isApprovedForAll(address account, address operator) view returns (bool)`
- `isQuoteOBValid(address user, (address provider, address taker, uint256 price, uint256 size, bool isBuy, uint256 deadline, uint256 salt) quoteOB, uint256 size, (uint8 v, bytes32 r, bytes32 s) sig) view returns (bool, uint8)`
- `marketPrice() view returns (uint256)`
- `maxFlashLoan(address token) view returns (uint256)`
- `multicall(bytes[] data) returns (bytes[] results)`
- `name() view returns (string)`
- `nomineeOwner() view returns (address)`
- `owner() view returns (address)`
- `safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)`
- `safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)`
- `setApprovalForAll(address operator, bool status)`
- `setFallbackAddress(address fallbackAddress)`
- `settle() returns (uint256 collateral)`
- `settleFor(address[] holders, uint256 costPerHolder) returns (uint256[] collateral)`
- `settlePosition((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p) returns (uint256 collateral)`
- `settlePositionFor((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType)[] p, uint256 costPerHolder) returns (uint256[] collateral)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `takerFee(address taker, uint256 size, uint256 premium, bool isPremiumNormalized, bool isOrderbook) view returns (uint256)`
- `ticks() view returns (((int256 delta, uint256 externalFeeRate, int256 longDelta, int256 shortDelta, uint256 counter) tick, uint256 price, uint256 longRate, uint256 shortRate)[])`
- `tokensByAccount(address account) view returns (uint256[])`
- `totalHolders(uint256 id) view returns (uint256)`
- `totalSupply(uint256 id) view returns (uint256)`
- `trade(uint256 size, bool isBuy, uint256 premiumLimit, address referrer) returns (uint256 totalPremium, (int256 collateral, int256 longs, int256 shorts) delta)`
- `transferOwnership(address account)`
- `transferPosition((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) srcP, address newOwner, address newOperator, uint256 size)`
- `tryCacheSettlementPrice()`
- `withdraw((address owner, address operator, uint256 lower, uint256 upper, uint8 orderType) p, uint256 size, uint256 minMarketPrice, uint256 maxMarketPrice) returns ((int256 collateral, int256 longs, int256 shorts) delta)`
- `writeFrom(address underwriter, address longReceiver, uint256 size, address referrer)`

Left out of this ABI, though its deployments declare them:

- `error AddressUtils__NotContract` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DiamondWritable__RemoveTargetNotZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DiamondWritable__ReplaceTargetIsIdentical` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DiamondWritable__SelectorAlreadyAdded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DiamondWritable__SelectorNotFound` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DiamondWritable__TargetHasNoCode` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DoublyLinkedList__InvalidInput` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DoublyLinkedList__NonExistentEntry` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSA__InvalidSignature` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSA__InvalidV` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC1155Base__ArrayLengthMismatch` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC1155Base__MintToZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC1155Base__NotOwnerOrApproved` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC1155Base__SelfApproval` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC1155Base__TransferExceedsBalance` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC165Base__InvalidInterfaceId` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Ownable__NotTransitiveOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__AboveQuoteSize` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__ActionNotAuthorized` taking `(address,address,uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__CostExceedsPayout` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__CostNotAuthorized` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__DifferenceOfSizeAndContractDeltaTooLarge` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__FlashLoanCallbackFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__FlashLoanNotRepayed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InsufficientAskLiquidity` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidAssetUpdate` taking `(int256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidBelowPrice` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidMonth` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidQuoteOBTaker` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidRange` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidReconciliation` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidSize` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__InvalidTickPrice` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__NotPoolToken` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__NotWrappedNativeTokenPool` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__OptionExpired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__OptionNotExpired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__PositionDoesNotExist` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__QuoteOBExpired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__SettlementPriceAlreadyCached` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pool__WithdrawalDelayNotElapsed` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Position__InvalidOrderType` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Position__InvalidPositionUpdate` taking `(uint256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Position__LowerGreaterOrEqualUpper` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PRBMath_MulDiv_Overflow` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PRBMath_UD60x18_IntoSD59x18_Overflow` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pricing__PriceCannotBeComputedWithinTickRange` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pricing__PriceOutOfRange` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Pricing__UpperNotGreaterThanLower` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Proxy__ImplementationIsNotContract` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReentrancyGuard__ReentrantCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeERC20__OperationFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SD49x28_IntoUD50x28_Underflow` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UD50x28_IntoSD49x28_Overflow` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UD60x18_IntoUD50x28_Overflow` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

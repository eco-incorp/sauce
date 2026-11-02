<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Premia` on arbitrum |
| Chains | arbitrum |
| Document | [premia.md](../premia.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Premia` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's poolFactory, `0xAE4fB6622F25f397587F11638dA8CE88C27b5645`.
  require(Premia.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | `Premia.PoolFactory` |

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

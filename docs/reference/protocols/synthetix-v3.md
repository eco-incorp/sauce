<!-- Generated from the SDK's registries. Do not edit. -->

# Synthetix V3 (`synthetix-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Synthetix V3 is a synthetic assets protocol: tokens that follow the price of something else. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Modular liquidity protocol powering perpetual futures and synthetic assets on Base. Account-based system with collateral delegation to liquidity pools.

| Fact | Value |
| --- | --- |
| Category | Synthetics |
| Family | `Synthetix`: `synthetix-v3` |
| Namespace | `SynthetixV3` on base |
| Chains | base |

## What it offers

- **deposit**: Deposit collateral into an account
- **withdraw**: Withdraw collateral from an account
- **delegateCollateral**: Delegate collateral to a pool (via CoreProxy)
- **commitOrder**: Commit a perps trade order (via PerpsMarketProxy)
- **modifyCollateral**: Modify perps account collateral

## Notes

- TVL: $300M+. Account-based system - create account NFT first
- accountId is uint128, collateral ops use token amount in token decimals
- delegateCollateral assigns collateral to a specific pool for earning fees
- commitOrder sizeDelta: positive = long, negative = short
- Settlement happens asynchronously via keepers after commitOrder

## Its names in a program

On Base, `SynthetixV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's coreProxy, `0x32C222A9A159782aFD7529c87FA34b96CA72C696`.
  require(SynthetixV3.CoreProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | coreProxy | `0x32C222A9A159782aFD7529c87FA34b96CA72C696` | `SynthetixV3.CoreProxy` |
| [Base](../chains/base.md) | perpsMarketProxy | `0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce` | `SynthetixV3.PerpsMarketProxy` |

## ABI

### `CoreProxyABI`

`import CoreProxyABI from "./protocols/synthetix-v3/CoreProxyABI.json";` Speaks for: coreProxy.

- `deposit(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `withdraw(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `delegateCollateral(uint128 accountId, uint128 poolId, address collateralType, uint256 amount, uint256 leverage)`

### `PerpsMarketProxyABI`

`import PerpsMarketProxyABI from "./protocols/synthetix-v3/PerpsMarketProxyABI.json";` Speaks for: perpsMarketProxy.

- `commitOrder((uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) commitment) returns ((uint256 commitmentTime, (uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) request) retOrder, uint256 fees)`
- `modifyCollateral(uint128 accountId, uint128 collateralId, int256 amountDelta)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

# Pyth Network

High-fidelity oracle network providing low-latency price feeds from institutional sources. Uses pull-based model for efficient on-chain price updates.

## Category

oracle | Chains and addresses: [registry/pyth.md](registry/pyth.md)

## Key Operations

- **getPrice**: Read price from Pyth oracle by price feed ID

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Get price by feed ID
import { PythOracleABI as IPythOracle } from "./abis";
function main(
  oracleAddress: Address,
  priceId: Uint256,
): { price: Int256; conf: Uint256; expo: Int256; publishTime: Uint256 } {
  const oracle = IPythOracle.at(oracleAddress);
  return oracle.getPrice(priceId);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/pyth.md](registry/pyth.md).

## Notes

- Pull-based oracle: users must call updatePriceFeeds before reading prices
- Sub-second latency from institutional market data providers
- `price` (ABI `int64`) and `expo` (ABI `int32`) are `Int256`; preserve their mathematical signs in arithmetic and comparisons. `conf` and `publishTime` remain `Uint256`
- Actual price = price * 10^expo (e.g. price=12345, expo=-2 means $123.45)
- Price feed IDs are bytes32 - see Pyth docs for specific feed IDs per asset
- updatePriceFeeds requires sending ETH to pay the update fee (use getUpdateFee to check)
- Get price update data from Pyth Hermes API off-chain, then submit on-chain

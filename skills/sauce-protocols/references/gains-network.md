# Gains Network

Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex pairs. Diamond proxy architecture.

## Category

perpetuals | Chains and addresses: [registry/gains-network.md](registry/gains-network.md)

## Key Operations

- **closeTradeMarket**: Close an open trade at market price
- **updateStopLoss**: Update stop loss on an open trade
- **updateTakeProfit**: Update take profit on an open trade

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Close trade at market price
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, expectedPrice: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.closeTradeMarket(index, expectedPrice);
  return 1;
}

// Update stop loss
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, newSl: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateSl(index, newSl);
  return 1;
}

// Update take profit
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, newTp: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateTp(index, newTp);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gains-network.md](registry/gains-network.md).

## Notes

- TVL: $50M+. Up to 1000x leverage on forex, 250x on crypto
- Diamond proxy pattern - single contract for all operations
- pairIndex identifies the trading pair (0=BTC/USD, 1=ETH/USD, etc.)
- index identifies one of the trader's trades (a trader can have several)
- openTrade uses complex tuple param for trade parameters
- These are the multi-collateral Diamond's (v8+) signatures. A trade is addressed by the trader's own `index` (their Nth trade), not by `(pairIndex, index)`.

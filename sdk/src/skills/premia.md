# Premia

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

## Category

options | Chains: Arbitrum, Ethereum

## Key Operations

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/premia";
```

## SauceScript Examples

```typescript
// Exercise long option
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, holder: Address, longTokenId: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  return diamond.exercise(holder, longTokenId);
}

// Settle short option
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, holder: Address, shortTokenId: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  return diamond.settle(holder, shortTokenId);
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Arbitrum | diamond  | `0xa079C6B032133b95Cf8b3d273D27eeb6B110a469` |
| Ethereum | diamond  | `0xc22FAe86443aEed038A4ED887bbA8F5035FD12F0` |

## ABI Methods

### DiamondABI

- `trade(bytes32,uint256,bool,uint256,address)` - Buy/sell options. Params: poolKey (identifies option market), size (option amount), isBuy (true=buy, false=sell), premiumLimit (max/min premium), referrer. Returns totalPremium
- `exercise(address,uint256)` - Exercise long option. Params: holder, longTokenId. Returns exerciseValue (profit amount)
- `settle(address,uint256)` - Settle short option after expiry. Params: holder, shortTokenId. Returns collateral (returned amount)

## Notes

- Diamond proxy pattern - single contract for all operations
- Supports calls and puts on ETH, BTC, and other assets
- poolKey (bytes32) encodes the option parameters (strike, expiry, type)
- Long token = bought option, short token = sold/written option
- exercise returns the in-the-money value; settle returns remaining collateral to writers

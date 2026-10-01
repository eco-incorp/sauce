# 0x Protocol

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.

## Category

aggregator | Chains: Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, Base

## Key Operations

- **transformERC20**: Execute a token swap via the Exchange Proxy transformer pipeline

## SDK Usage

```typescript
import { protocolInfo, deployments, transformERC20 } from "@eco-incorp/sauce/protocols/zerox";
```

## SauceScript Examples

```typescript
// Note: 0x requires off-chain route computation via 0x API before on-chain execution.
// The transformERC20 function uses transformations array populated from API response.
```

## Key Addresses

| Chain     | Contract      | Address                                      |
| --------- | ------------- | -------------------------------------------- |
| Ethereum  | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |
| Arbitrum  | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |
| Optimism  | exchangeProxy | `0xDEF1ABE32c034e558Cdd535791643C58a13aCC10` |
| Polygon   | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |
| BSC       | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |
| Avalanche | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |
| Base      | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` |

## ABI Methods

### ExchangeProxyABI

- `transformERC20(address,address,uint256,uint256,tuple[])` - Execute token swap via transformer pipeline. Payable. Params: inputToken, outputToken, inputTokenAmount, minOutputTokenAmount, transformations (array of Transformation tuples). Returns outputTokenAmount
  - Transformation tuple: `{ deploymentNonce (uint32), data (bytes) }` - Each transformation specifies a deployed transformer and its calldata

## Notes

- Same Exchange Proxy address across all 7 chains
- Uses transformer pipeline architecture - each swap is a sequence of transformations
- Route computation happens via 0x API - transformations array comes from API response
- Approve inputToken to exchangeProxy before swapping
- 0x API provides the optimal route, slippage protection, and transformer calldata

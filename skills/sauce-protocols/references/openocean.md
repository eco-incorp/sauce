# OpenOcean

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.

## Category

aggregator | Chains: Ethereum, Arbitrum, Optimism, BSC, Polygon, Avalanche, Fantom

## Key Operations

- **swap**: Execute aggregated swap via OpenOcean Exchange

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/openocean";
```

## SauceScript Examples

```typescript
// Swap via OpenOcean
import { OpenOceanExchangeV2ABI as IOpenOceanExchange } from "./abis";
function main(
  exchangeAddress: Address,
  caller: Address,
  srcToken: Address,
  dstToken: Address,
  srcReceiver: Address,
  dstReceiver: Address,
  amount: Uint256,
  minReturnAmount: Uint256,
  guaranteedAmount: Uint256,
  referrer: Address,
  calls: { target: Uint256; gasLimit: Uint256; value: Uint256; data: bytes }[],
): Uint256 {
  const exchange = IOpenOceanExchange.at(exchangeAddress);
  return exchange.swap(
    caller,
    {
      srcToken: srcToken,
      dstToken: dstToken,
      srcReceiver: srcReceiver,
      dstReceiver: dstReceiver,
      amount: amount,
      minReturnAmount: minReturnAmount,
      guaranteedAmount: guaranteedAmount,
      flags: 0,
      referrer: referrer,
      permit: 0x00,
    },
    calls,
  );
}
```

## Key Addresses

| Chain     | Contract   | Address                                      |
| --------- | ---------- | -------------------------------------------- |
| Ethereum  | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| Arbitrum  | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| Optimism  | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| BSC       | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| Polygon   | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| Avalanche | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| Fantom    | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |

## ABI Methods

### OpenOceanExchangeV2ABI

- `swap(address,tuple,tuple[])` - Execute aggregated swap. Payable. Params: caller (msg.sender or executor), desc (SwapDescription tuple), calls (CallDescription[]: `(uint256 target, uint256 gasLimit, uint256 value, bytes data)`). Returns returnAmount
  - SwapDescription tuple: `{ srcToken, dstToken, srcReceiver, dstReceiver, amount, minReturnAmount, guaranteedAmount, flags, referrer, permit }`
  - `srcReceiver` - address that receives srcToken from caller
  - `dstReceiver` - address that receives output tokens
  - `guaranteedAmount` - guaranteed minimum output (can differ from minReturnAmount)
  - `flags` - swap behavior flags (0 for default)
  - `permit` - EIP-2612 permit data (0x00 if pre-approved)

## Notes

- TVL: $200M+. Same contract address across all 7 supported chains
- Route computation via OpenOcean API - calls parameter comes from API response
- Approve srcToken to exchangeV2 before swapping
- caller is typically msg.sender; srcReceiver receives tokens from the caller

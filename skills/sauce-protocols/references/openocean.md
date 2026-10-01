# OpenOcean

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.

## Category

aggregator | Chains and addresses: [registry/openocean.md](registry/openocean.md)

## Key Operations

- **swap**: Execute aggregated swap via OpenOcean Exchange

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/openocean.md](registry/openocean.md).

## Notes

- TVL: $200M+. Same contract address across all 7 supported chains
- Route computation via OpenOcean API - calls parameter comes from API response
- Approve srcToken to exchangeV2 before swapping
- caller is typically msg.sender; srcReceiver receives tokens from the caller

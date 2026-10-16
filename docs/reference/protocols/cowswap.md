<!-- Generated from the SDK's registries. Do not edit. -->

# CoW Swap (`cowswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> CoW Swap is an exchange aggregator: it looks across many exchanges for the best price. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) to find optimal prices while protecting users from frontrunning.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Cowswap` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Key Operations

- **preSignOrder**: Pre-sign an order on-chain for execution by solvers
- **invalidateOrder**: Cancel/invalidate a pending order

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Pre-sign order on-chain
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";
function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.setPreSignature(orderUid, true);
  return 1;
}

// Invalidate/cancel order
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";
function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.invalidateOrder(orderUid);
  return 1;
}
```

## Notes

- MEV-protected: batch auctions match Coincidence of Wants (overlapping orders) first
- Orders are typically signed off-chain and submitted to CoW Protocol API
- setPreSignature is for smart contracts/multisigs that cannot produce ECDSA signatures
- orderUid encodes: order hash + owner address + validTo timestamp
- Same settlement contract on both Ethereum and Arbitrum
- Approve tokens to the GPv2VaultRelayer (not settlement contract) before trading

## Its names in a program

On Ethereum, `Cowswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gpv2Settlement, `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`.
  require(Cowswap.GPv2Settlement != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [Arbitrum One](../chains/arbitrum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |

## ABI

### `GPv2SettlementABI`

`import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";` Speaks for: gpv2Settlement.

- `setPreSignature(bytes orderUid, bool signed)`
- `invalidateOrder(bytes orderUid)`

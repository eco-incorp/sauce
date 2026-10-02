# Arbitrum Native Bridge

Official Arbitrum L1-L2 gateway bridge. Routes tokens through the canonical Arbitrum rollup bridge with 7-day withdrawal finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Arbitrum) | Chains and addresses: [registry/arbitrum-bridge.md](registry/arbitrum-bridge.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### depositToL2

Deposit ERC-20 tokens from Ethereum L1 to Arbitrum L2 via the Gateway Router.

```typescript
import { ArbitrumL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(
  routerAddress: Address,
  token: Address,
  recipient: Address,
  amount: Uint256,
  maxGas: Uint256,
  gasPriceBid: Uint256,
): bytes {
  const router = IL1GatewayRouter.at(routerAddress);
  return router.outboundTransfer(token, recipient, amount, maxGas, gasPriceBid, 0x00);
}
```

- `token`: L1 ERC-20 token address to bridge
- `recipient`: Address to receive tokens on Arbitrum L2
- `amount`: Amount of tokens to deposit
- `maxGas`: Maximum L2 gas for the deposit transaction (e.g. 300000). Excess is refunded
- `gasPriceBid`: L2 gas price bid in wei. Use Arbitrum's `ArbGasInfo.getMinimumGasPrice()` or estimate
- `_data`: Extra data, typically `0x00` for standard deposits. Used for custom gateway params
- Requires ERC-20 approval to the appropriate gateway (use `getGateway(token)` to find it)
- Requires ETH as msg.value to cover L2 execution costs (`maxGas * gasPriceBid + maxSubmissionCost`)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/arbitrum-bridge.md](registry/arbitrum-bridge.md).

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use `ArbSys.sendTxToL1()` on Arbitrum (takes 7 days)
- The router auto-routes tokens to the correct gateway (standard, custom, or WETH gateway)
- **Approval target**: approve tokens to the gateway returned by `getGateway(token)`, NOT to the router itself
- `msg.value` must cover: `maxSubmissionCost + (maxGas * gasPriceBid)` for L2 execution
- L1 to L2 deposits finalize in ~10-15 minutes (after L1 finality + sequencer inclusion)
- L2 to L1 withdrawals require 7-day challenge period before funds can be claimed on L1
- For ETH deposits, send ETH directly to the Arbitrum Delayed Inbox (no token approval needed)
- Canonical bridge -- no third-party risk, secured by the Arbitrum rollup itself
- Audited

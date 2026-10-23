<!-- Generated from the SDK's registries. Do not edit. -->

# Arbitrum Native Bridge (`arbitrum-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Arbitrum Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Arbitrum L1-L2 gateway bridge. Routes tokens through the canonical Arbitrum rollup bridge with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ArbitrumBridge` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use `ArbSys.sendTxToL1()` on Arbitrum (takes 7 days)
- The router auto-routes tokens to the correct gateway (standard, custom, or WETH gateway)
- **Approval target**: approve tokens to the gateway returned by `getGateway(token)`, NOT to the router itself
- `msg.value` must cover: `maxSubmissionCost + (maxGas * gasPriceBid)` for L2 execution
- L1 to L2 deposits finalize in ~10-15 minutes (after L1 finality + sequencer inclusion)
- L2 to L1 withdrawals require 7-day challenge period before funds can be claimed on L1
- For ETH deposits, send ETH directly to the Arbitrum Delayed Inbox (no token approval needed)
- Canonical bridge, secured by the Arbitrum rollup itself
- Audited

## Its names in a program

On Ethereum, `ArbitrumBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1GatewayRouter, `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef`.
  require(ArbitrumBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1GatewayRouter | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` | `ArbitrumBridge.L1GatewayRouter` |
| [Arbitrum One](../chains/arbitrum.md) | l2GatewayRouter | `0x5288c571Fd7aD117beA99bF60FE0846C4E84F933` | `ArbitrumBridge.L2GatewayRouter` |

## ABI

### `ArbitrumL1GatewayRouterABI`

`import ArbitrumL1GatewayRouterABI from "./protocols/arbitrum-bridge/ArbitrumL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `outboundTransfer(address _token, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes _data) payable returns (bytes)`
- `getGateway(address _token) view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

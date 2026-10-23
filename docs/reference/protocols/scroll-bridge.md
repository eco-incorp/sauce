<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll Native Bridge (`scroll-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Scroll Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Scroll zkEVM bridge via L1ScrollMessenger and L1GatewayRouter. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ScrollBridge` on ethereum, scroll |
| Chains | ethereum, scroll |

## Notes

- **L1 to L2** via GatewayRouter (for token deposits) or L1ScrollMessenger (for arbitrary messages)
- zkEVM architecture -- withdrawals finalize with ZK proofs (faster than optimistic rollups, typically hours not days)
- GatewayRouter auto-routes tokens to the correct gateway (standard ERC-20, WETH, custom gateways)
- `msg.value` must include gas fees for L2 execution (even for ERC-20 deposits)
- L1 to L2 deposits finalize after ZK proof generation (~1-4 hours)
- L2 to L1 withdrawals also require ZK proof finalization (~1-4 hours)
- Canonical bridge, secured by Scroll's ZK proving system
- Audited

## Its names in a program

On Ethereum, `ScrollBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1GatewayRouter, `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6`.
  require(ScrollBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Ethereum](../chains/ethereum.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Scroll](../chains/scroll.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll](../chains/scroll.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |

## ABI

### `ScrollL1GatewayRouterABI`

`import ScrollL1GatewayRouterABI from "./protocols/scroll-bridge/ScrollL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `depositETH(uint256 _amount, uint256 _gasLimit) payable`
- `depositERC20(address _token, uint256 _amount, uint256 _gasLimit) payable`

### `ScrollL1MessengerABI`

`import ScrollL1MessengerABI from "./protocols/scroll-bridge/ScrollL1MessengerABI.json";` Speaks for: l1ScrollMessenger.

- `sendMessage(address to, uint256 value, bytes message, uint256 gasLimit) payable`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

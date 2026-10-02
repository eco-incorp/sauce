<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll Native Bridge (`scroll-bridge`)

Official Scroll zkEVM bridge via L1ScrollMessenger. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ScrollBridge` on ethereum, scroll |
| Chains | ethereum, scroll |
| Document | [scroll-bridge.md](../scroll-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `ScrollBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1GatewayRouter, `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6`.
  require(ScrollBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |

## ABI

### `ScrollL1GatewayRouterABI`

`import ScrollL1GatewayRouterABI from "./protocols/scroll-bridge/ScrollL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `depositETH(uint256 _amount, uint256 _gasLimit) payable`
- `depositERC20(address _token, uint256 _amount, uint256 _gasLimit) payable`

### `ScrollL1MessengerABI`

`import ScrollL1MessengerABI from "./protocols/scroll-bridge/ScrollL1MessengerABI.json";` Speaks for: l1ScrollMessenger.

- `sendMessage(address to, uint256 value, bytes message, uint256 gasLimit) payable`

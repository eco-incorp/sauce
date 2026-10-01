<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll Native Bridge (`scroll-bridge`)

Official Scroll zkEVM bridge via L1ScrollMessenger. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, scroll |
| Document | [scroll-bridge.md](../scroll-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1GatewayRouter):

```sauce chain=ethereum
import ScrollL1GatewayRouterABI from "./protocols/scroll-bridge/ScrollL1GatewayRouterABI.json";

const L1_GATEWAY_ROUTER = 0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6n;

function main() {
  const bound = ScrollL1GatewayRouterABI.at(L1_GATEWAY_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollL1GatewayRouterABI.at(0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollL1MessengerABI.at(0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367n)` |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | no registry ABI |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | no registry ABI |

## ABI

### `ScrollL1GatewayRouterABI`

`import ScrollL1GatewayRouterABI from "./protocols/scroll-bridge/ScrollL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `depositETH(uint256 _amount, uint256 _gasLimit) payable`
- `depositERC20(address _token, uint256 _amount, uint256 _gasLimit) payable`

### `ScrollL1MessengerABI`

`import ScrollL1MessengerABI from "./protocols/scroll-bridge/ScrollL1MessengerABI.json";` Speaks for: l1ScrollMessenger.

- `sendMessage(address to, uint256 value, bytes message, uint256 gasLimit) payable`

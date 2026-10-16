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

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### depositETH

Deposit ETH from Ethereum L1 to Scroll L2.

```typescript
import { ScrollL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(gatewayRouterAddress: Address, amount: Uint256, gasLimit: Uint256): Uint256 {
  const router = IL1GatewayRouter.at(gatewayRouterAddress);
  router.depositETH(amount, gasLimit);
  return 1;
}
```

- `amount`: Amount of ETH to deposit (also send as `msg.value`)
- `gasLimit`: L2 gas limit for the deposit execution (e.g. 200000)
- Requires ETH as msg.value covering amount + L2 gas fees

### depositERC20

Deposit ERC-20 tokens from Ethereum L1 to Scroll L2.

```typescript
import { ScrollL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(
  gatewayRouterAddress: Address,
  token: Address,
  amount: Uint256,
  gasLimit: Uint256,
): Uint256 {
  const router = IL1GatewayRouter.at(gatewayRouterAddress);
  router.depositERC20(token, amount, gasLimit);
  return 1;
}
```

- `token`: L1 ERC-20 token address
- `amount`: Amount of tokens to deposit
- `gasLimit`: L2 gas limit for the deposit execution (e.g. 200000)
- Requires ERC-20 approval to the L1GatewayRouter
- Requires ETH as msg.value for L2 gas fees

## Notes

- **L1 to L2** via GatewayRouter (for token deposits) or L1ScrollMessenger (for arbitrary messages)
- zkEVM architecture -- withdrawals finalize with ZK proofs (faster than optimistic rollups, typically hours not days)
- GatewayRouter auto-routes tokens to the correct gateway (standard ERC-20, WETH, custom gateways)
- `msg.value` must include gas fees for L2 execution (even for ERC-20 deposits)
- L1 to L2 deposits finalize after ZK proof generation (~1-4 hours)
- L2 to L1 withdrawals also require ZK proof finalization (~1-4 hours)
- Canonical bridge -- no third-party risk, secured by Scroll's ZK proving system
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

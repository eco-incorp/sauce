# Scroll Native Bridge

Official Scroll zkEVM bridge via L1ScrollMessenger and L1GatewayRouter. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Scroll) | Chains and addresses: [registry/scroll-bridge.md](registry/scroll-bridge.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/scroll-bridge.md](registry/scroll-bridge.md).

## Notes

- **L1 to L2** via GatewayRouter (for token deposits) or L1ScrollMessenger (for arbitrary messages)
- zkEVM architecture -- withdrawals finalize with ZK proofs (faster than optimistic rollups, typically hours not days)
- GatewayRouter auto-routes tokens to the correct gateway (standard ERC-20, WETH, custom gateways)
- `msg.value` must include gas fees for L2 execution (even for ERC-20 deposits)
- L1 to L2 deposits finalize after ZK proof generation (~1-4 hours)
- L2 to L1 withdrawals also require ZK proof finalization (~1-4 hours)
- Canonical bridge -- no third-party risk, secured by Scroll's ZK proving system
- Audited

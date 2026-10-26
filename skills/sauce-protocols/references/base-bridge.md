# Base Native Bridge

Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base. OP Stack architecture with 7-day withdrawal finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Base) | Chains and addresses: [registry/base-bridge.md](registry/base-bridge.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### depositETHTo

Deposit ETH from Ethereum L1 to `recipient` on Base L2. A Sauce program runs in its Pot, a contract: use the `*To` forms, because `depositETH` and `depositERC20` revert when a contract calls them ("StandardBridge: function can only be called from an EOA").

```typescript
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address, recipient: Address): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositETHTo(recipient, 200000, hex``);
  return 1;
}
```

- ETH amount is sent as `msg.value`
- `recipient`: who receives the ETH on Base, the user's wallet unless they chose otherwise
- `_minGasLimit`: Minimum gas for the L2 deposit execution (200000 is a safe default)
- `_extraData`: Optional extra data (typically ` hex`` `)

### depositERC20To

Deposit ERC-20 tokens from Ethereum L1 to `recipient` on Base L2.

```typescript
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(
  bridgeAddress: Address,
  l1Token: Address,
  l2Token: Address,
  recipient: Address,
  amount: Uint256,
): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositERC20To(l1Token, l2Token, recipient, amount, 200000, hex``);
  return 1;
}
```

- `l1Token`: Token address on Ethereum L1
- `l2Token`: Corresponding token address on Base L2 (must be the official bridged representation)
- `recipient`: who receives the tokens on Base
- `amount`: Amount of tokens to deposit
- `_minGasLimit`: Minimum gas for L2 execution (200000 is a safe default)
- `_extraData`: Optional extra data (typically ` hex`` `)
- Requires ERC-20 approval to the L1StandardBridge

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/base-bridge.md](registry/base-bridge.md).

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use the L2StandardBridge on Base (takes 7 days)
- OP Stack architecture -- same bridge pattern as Optimism, Mode, Zora
- `depositETH` / `depositERC20` are for an externally owned account only: called from a contract, a Pot included, they revert with "StandardBridge: function can only be called from an EOA". A Sauce program uses `depositETHTo` / `depositERC20To` and names the recipient, the user's wallet unless they chose otherwise
- L1 to L2 deposits finalize in ~2-5 minutes (after L1 inclusion + sequencer processing)
- L2 to L1 withdrawals require 7-day challenge period (optimistic rollup security)
- `_l2Token` must be the official bridged token representation on Base -- incorrect L2 token address will cause deposit to fail
- Canonical bridge, secured by the Base (OP Stack) rollup itself
- L2StandardBridge is at a predefined address: `0x4200000000000000000000000000000000000010`
- Audited

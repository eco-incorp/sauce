<!-- Generated from the SDK's registries. Do not edit. -->

# Optimism Native Bridge (`optimism-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Optimism Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Optimism L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Optimism. OP Stack architecture with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `OptimismBridge` on ethereum, optimism |
| Chains | ethereum, optimism |

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use the L2StandardBridge on Optimism (takes 7 days)
- OP Stack architecture -- same pattern used by Base, Mode, Zora, and other OP chains
- `depositETH` / `depositERC20` send to `msg.sender` on L2, which in a Sauce program is the Pot's address there, not the user's wallet. Use `depositETHTo` / `depositERC20To` to name the recipient, the user's wallet unless they chose otherwise
- L1 to L2 deposits finalize in ~2-5 minutes (after L1 inclusion + sequencer processing)
- L2 to L1 withdrawals require 7-day challenge period (optimistic rollup security)
- `_l2Token` must be the official bridged token representation on Optimism -- incorrect L2 token address will cause deposit to fail
- Canonical bridge, secured by the Optimism rollup itself
- L2StandardBridge is at a predefined address: `0x4200000000000000000000000000000000000010`
- Audited

## Its names in a program

On Ethereum, `OptimismBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1StandardBridge, `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1`.
  require(OptimismBridge.L1StandardBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | `OptimismBridge.L1StandardBridge` |
| [Optimism](../chains/optimism.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `OptimismBridge.L2StandardBridge` |

## ABI

### `OptimismL1StandardBridgeABI`

`import OptimismL1StandardBridgeABI from "./protocols/optimism-bridge/OptimismL1StandardBridgeABI.json";` Speaks for: l1StandardBridge.

- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

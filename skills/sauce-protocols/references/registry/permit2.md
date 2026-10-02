<!-- Generated from the SDK's registries. Do not edit. -->

# Permit2 (`permit2`)

Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols, improving security and UX.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Permit2` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| Document | [permit2.md](../permit2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Permit2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's permit2, `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
  require(Permit2.Permit2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Monad](../../../sauce-chains/references/monad.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Arc](../../../sauce-chains/references/arc.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Base](../../../sauce-chains/references/base.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |

## ABI

### `Permit2ABI`

`import Permit2ABI from "./protocols/permit2/Permit2ABI.json";` Speaks for: permit2.

- `approve(address token, address spender, uint160 amount, uint48 expiration)`
- `transferFrom(address from, address to, uint160 amount, address token)`
- `permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)`
- `nonceBitmap(address owner, uint256 wordPosition) view returns (uint256)`
- `lockdown((address token, address spender)[] approvals)`

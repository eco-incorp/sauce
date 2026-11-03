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

`import Permit2ABI from "./protocols/permit2/Permit2ABI.json";` Speaks for: permit2. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Permit2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `allowance(address, address, address) view returns (uint160 amount, uint48 expiration, uint48 nonce)`
- `approve(address token, address spender, uint160 amount, uint48 expiration)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `invalidateNonces(address token, address spender, uint48 newNonce)`
- `invalidateUnorderedNonces(uint256 wordPos, uint256 mask)`
- `lockdown((address token, address spender)[] approvals)`
- `nonceBitmap(address owner, uint256 wordPosition) view returns (uint256)`
- `permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)`
- `permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)`
- `permitWitnessTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)`
- `transferFrom((address from, address to, uint160 amount, address token)[] transferDetails)`
- `transferFrom(address from, address to, uint160 amount, address token)`

Left out of this ABI by name, and called by their signature through the namespace:

- `Permit2.Permit2["permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)"](…)`: `permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)`; an overload of permit(address,((address,uint160,uint48,uint48),address,uint256),bytes), which takes as many arguments: a call by name picks its overload by argument count, so this one is called by its signature.
- `Permit2.Permit2["permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"](…)`: `permitTransferFrom(((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount)[] transferDetails, address owner, bytes signature)`; an overload of permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes), which takes as many arguments: a call by name picks its overload by argument count, so this one is called by its signature.
- `Permit2.Permit2["permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)"](…)`: `permitWitnessTransferFrom(((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount)[] transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)`; an overload of permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes), which takes as many arguments: a call by name picks its overload by argument count, so this one is called by its signature.

<!-- Generated from the SDK's registries. Do not edit. -->

# Permit2 (`permit2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Permit2 is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Permit2` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |

## When to use it

- Uniswap's token-approval contract at one address on every chain it is on. A signature transfer
  (`permitTransferFrom`) moves a user's tokens with a one-time signed permit; an allowance
  transfer (`approve` with an expiry, then `transferFrom`) works like an expiring ERC-20
  allowance.
- `sauce run --fund` pulls with Permit2 by default: the owner signs, the Pot receives.

## Pitfalls for a program

- The user approves Permit2 itself once per token, by an ordinary ERC-20 `approve`.
- A signed permit names the spender (the contract calling Permit2: the Pot), the amount, a
  nonce and a deadline; nonces are unordered bits, each usable once.
- Allowance amounts are `uint160` and expiries `uint48`.

## In a Sauce program

Pull a user's tokens into the Pot with their signed permit:

```ts
function main(
  owner: Address,
  token: Address,
  amount: Uint256,
  nonce: Uint256,
  deadline: Uint256,
  signature: bytes
) {
  const permit = { permitted: { token: token, amount: amount }, nonce: nonce, deadline: deadline };
  const details = { to: pot, requestedAmount: amount };
  const before = Token(token).balanceOf(pot);
  Permit2.Permit2.permitTransferFrom(permit, details, owner, signature);
  require(Token(token).balanceOf(pot) - before == amount, "the permit moved another amount");
}
```

## What it offers

- **approve**: Set token allowance for a spender via Permit2
- **transferFrom**: Transfer tokens using a Permit2 allowance

## Notes

- Same address on all 9 chains (deterministic CREATE2 deployment)
- Approve once: ERC-20 approve to Permit2, then use Permit2 to manage per-protocol allowances
- amount is uint160 (not uint256) - max value is type(uint160).max
- expiration is uint48 unix timestamp - approvals auto-expire for security
- Uniswap V3/V4, 1inch, and many protocols use Permit2 for token transfers
- lockdown is an emergency function to batch-revoke compromised approvals

## Its names in a program

On Ethereum, `Permit2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's permit2, `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
  require(Permit2.Permit2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Optimism](../chains/optimism.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [BNB Chain](../chains/bsc.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Polygon](../chains/polygon.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Monad](../chains/monad.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Arc](../chains/arc.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Base](../chains/base.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Arbitrum One](../chains/arbitrum.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Avalanche C-Chain](../chains/avalanche.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |

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

Left out of this ABI, though its deployments declare them:

- `permit` taking `(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)`: an overload of permit(address,((address,uint160,uint48,uint48),address,uint256),bytes), which takes as many arguments: a call picks its overload by argument count.
- `permitTransferFrom` taking `(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)`: an overload of permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes), which takes as many arguments: a call picks its overload by argument count.
- `permitWitnessTransferFrom` taking `(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)`: an overload of permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes), which takes as many arguments: a call picks its overload by argument count.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

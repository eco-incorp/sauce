# Permit2

Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols.

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

```sauce chain=base,arbitrum
function main(
  owner: Address,
  token: Address,
  amount: Uint256,
  nonce: Uint256,
  deadline: Uint256,
  signature: bytes
) {
  const self = ctx.self();
  const permit = { permitted: { token: token, amount: amount }, nonce: nonce, deadline: deadline };
  const details = { to: self, requestedAmount: amount };
  const before = Token(token).balanceOf(self);
  Permit2.Permit2.permitTransferFrom(permit, details, owner, signature);
  require(Token(token).balanceOf(self) - before == amount, "the permit moved another amount");
}
```

## Category

infrastructure | Chains and addresses: [registry/permit2.md](registry/permit2.md)

## Key Operations

- **approve**: Set token allowance for a spender via Permit2
- **transferFrom**: Transfer tokens using a Permit2 allowance

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Approve token via Permit2
import { Permit2ABI as IPermit2 } from "./abis";
function main(
  permit2Address: Address,
  token: Address,
  spender: Address,
  amount: Uint256,
  expiration: Uint256,
): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.approve(token, spender, amount, expiration);
  return 1;
}

// Transfer tokens using Permit2 allowance
import { Permit2ABI as IPermit2 } from "./abis";
function main(
  permit2Address: Address,
  from: Address,
  to: Address,
  amount: Uint256,
  token: Address,
): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.transferFrom(from, to, amount, token);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/permit2.md](registry/permit2.md).

## Notes

- Same address on all 9 chains (deterministic CREATE2 deployment)
- Approve once: ERC-20 approve to Permit2, then use Permit2 to manage per-protocol allowances
- amount is uint160 (not uint256) - max value is type(uint160).max
- expiration is uint48 unix timestamp - approvals auto-expire for security
- Uniswap V3/V4, 1inch, and many protocols use Permit2 for token transfers
- lockdown is an emergency function to batch-revoke compromised approvals

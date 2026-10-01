# CCTP

Circle's Cross-Chain Transfer Protocol moves native USDC between chains: `depositForBurn` burns it
on this chain, Circle attests the burn, and a `receiveMessage` on the destination mints it there.

## When to use it

- Move USDC to another chain as native USDC, with Circle's attestation as the only trust.
- Only the burn happens in the program's transaction. The mint is a separate transaction on the
  destination, sent by anyone with the attestation; to run code there too, open a Sauce intent
  (`sauce-intents`).

## Pitfalls for a program

- Approve the TokenMessenger for the amount first.
- `destinationDomain` is Circle's domain id, not the chain id: each chain's file in `sauce-chains`
  gives its CCTP domain.
- `mintRecipient` and `destinationCaller` are 32-byte words: an EVM address fits as is, and a
  `destinationCaller` of `0n` lets anyone complete the mint.
- `minFinalityThreshold` 2000 waits for standard finality; 1000 asks for a fast transfer, for which
  `maxFee` (in USDC units, taken on the destination) must cover Circle's fee.

## In a Sauce program

Burn the Pot's USDC on Base for `recipient` on Arbitrum:

```sauce chain=base
function main(amount: Uint256, recipient: Address, maxFee: Uint256) {
  // Arbitrum is CCTP domain 3; 2000 is standard finality (1000 asks for a fast transfer).
  USDC.approve(Cctp.TokenMessenger, amount);
  Cctp.TokenMessenger.depositForBurn(amount, 3n, recipient, USDC, 0n, maxFee, 2000n);
}
```

## Category

bridge | Chains and addresses: [registry/cctp.md](registry/cctp.md)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/cctp.md](registry/cctp.md).

## Notes

- Domains are Circle's numbering; the registry records them per chain.

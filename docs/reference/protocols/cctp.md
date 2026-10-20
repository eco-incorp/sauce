<!-- Generated from the SDK's registries. Do not edit. -->

# CCTP (`cctp`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> CCTP is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Circle's Cross-Chain Transfer Protocol moves native USDC between chains: `depositForBurn` burns it
on this chain, Circle attests the burn, and a `receiveMessage` on the destination mints it there.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Cctp` on ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea |
| Chains | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea |

## When to use it

- Move USDC to another chain as native USDC, with Circle's attestation as the only trust.
- Only the burn happens in the program's transaction. The mint is a separate transaction on the
  destination, sent by anyone with the attestation; to run code there too, open a Sauce intent
  ([intents](../../guides/intents.md)).

## Pitfalls for a program

- Approve the TokenMessenger for the amount first.
- `destinationDomain` is Circle's domain id, not the chain id: each chain's file in [chains](../chains.md)
  gives its CCTP domain.
- `mintRecipient` and `destinationCaller` are 32-byte words: an EVM address fits as is, and a
  `destinationCaller` of `0` lets anyone complete the mint.
- `minFinalityThreshold` 2000 waits for standard finality; 1000 asks for a fast transfer, for which
  `maxFee` (in USDC units, taken on the destination) must cover Circle's fee.

## In a Sauce program

Burn the Pot's USDC on Base for `recipient` on Arbitrum:

```ts
function main(amount: Uint256, recipient: Address, maxFee: Uint256) {
  // Arbitrum is CCTP domain 3; 2000 is standard finality (1000 asks for a fast transfer).
  USDC.approve(Cctp.TokenMessenger, amount);
  Cctp.TokenMessenger.depositForBurn(amount, 3, recipient, USDC, 0, maxFee, 2000);
}
```

## Notes

- Domains are Circle's numbering; the registry records them per chain.

## Its names in a program

On Ethereum, `Cctp` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's tokenMessenger, `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Optimism](../chains/optimism.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Unichain](../chains/unichain.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Polygon](../chains/polygon.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Monad](../chains/monad.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Sonic](../chains/sonic.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Arc](../chains/arc.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Base](../chains/base.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Arbitrum One](../chains/arbitrum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Avalanche C-Chain](../chains/avalanche.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Linea](../chains/linea.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |

## ABI

### `TokenMessengerABI`

`import TokenMessengerABI from "./protocols/cctp/TokenMessengerABI.json";` Speaks for: tokenMessenger.

- `depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

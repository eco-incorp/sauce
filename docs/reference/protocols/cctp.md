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
| Namespace | `Cctp` on ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |

## When to use it

- Move USDC to another chain as native USDC, with Circle's attestation as the only trust.
- Only the burn happens in the program's transaction. The mint is a separate transaction on the
  destination, sent by anyone with the attestation.

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

To Arc the domain is 26, for Arc and Arc Testnet alike. From Base to `recipient` on Arc, the
burn is `Cctp.TokenMessenger.depositForBurn(amount, 26, recipient, USDC, 0, maxFee, 2000)`, after
the same `approve`:

```ts
function main(amount: Uint256, recipient: Address, maxFee: Uint256) {
  // Arc is CCTP domain 26; on a testnet the same id reaches Arc Testnet.
  USDC.approve(Cctp.TokenMessenger, amount);
  Cctp.TokenMessenger.depositForBurn(amount, 26, recipient, USDC, 0, maxFee, 2000);
}
```

A burn on Arc spends Arc's `USDC` token, in its 6 decimals. Burn a given amount rather than
`pot.USDC` whole: the token and the Pot's native coin are one balance there.

A simulation or a cook of the burn shows only the source chain: USDC leaves the Pot and is burned.
The mint on the destination comes after Circle attests the burn, in a transaction of its own, which
no program here sends.

## Notes

- Domains are Circle's numbering; the registry records them per chain.
- On a testnet (Arc Testnet, Base Sepolia, Ethereum Sepolia) the TokenMessenger is Circle's
  testnet contract, not the mainnet one, and the domain is the mainnet's (Arc Testnet 26, Base
  Sepolia 6, Ethereum Sepolia 0). `Cctp.TokenMessenger` resolves to the chain's own; its
  attestation comes from Circle's sandbox API, `https://iris-api-sandbox.circle.com`.

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
| [Base Sepolia](../chains/base-sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Arc Testnet](../chains/arc-testnet.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Ethereum Sepolia](../chains/sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |

## ABI

### `TokenMessengerABI`

`import TokenMessengerABI from "./protocols/cctp/TokenMessengerABI.json";` Speaks for: tokenMessenger.

- `depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

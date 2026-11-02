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
| [Ethereum](../chains/ethereum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Optimism](../chains/optimism.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Unichain](../chains/unichain.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Polygon](../chains/polygon.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Monad](../chains/monad.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Sonic](../chains/sonic.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arc](../chains/arc.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Base](../chains/base.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arbitrum One](../chains/arbitrum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Avalanche C-Chain](../chains/avalanche.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Linea](../chains/linea.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Base Sepolia](../chains/base-sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arc Testnet](../chains/arc-testnet.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Ethereum Sepolia](../chains/sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |

## ABI

### `TokenMessengerABI`

`import TokenMessengerABI from "./protocols/cctp/TokenMessengerABI.json";` Speaks for: tokenMessenger.

- `acceptOwnership()`
- `addLocalMinter(address newLocalMinter)`
- `addRemoteTokenMessenger(uint32 domain, bytes32 tokenMessenger)`
- `denylist(address account)`
- `denylister() view returns (address)`
- `depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)`
- `depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)`
- `feeRecipient() view returns (address)`
- `getMinFeeAmount(uint256 amount) view returns (uint256)`
- `handleReceiveFinalizedMessage(uint32 remoteDomain, bytes32 sender, uint32, bytes messageBody) returns (bool)`
- `handleReceiveUnfinalizedMessage(uint32 remoteDomain, bytes32 sender, uint32 finalityThresholdExecuted, bytes messageBody) returns (bool)`
- `initialize((address owner, address rescuer, address feeRecipient, address denylister, address tokenMinter, address minFeeController) roles, uint256 minFee_, uint32[] remoteDomains_, bytes32[] remoteTokenMessengers_)`
- `initialize(address owner_, address rescuer_, address feeRecipient_, address denylister_, address tokenMinter_, uint32[] remoteDomains_, bytes32[] remoteTokenMessengers_)`
- `initializedVersion() view returns (uint64)`
- `isDenylisted(address account) view returns (bool)`
- `localMessageTransmitter() view returns (address)`
- `localMinter() view returns (address)`
- `messageBodyVersion() view returns (uint32)`
- `MIN_FEE_MULTIPLIER() view returns (uint256)`
- `minFee() view returns (uint256)`
- `minFeeController() view returns (address)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `remoteTokenMessengers(uint32) view returns (bytes32)`
- `removeLocalMinter()`
- `removeRemoteTokenMessenger(uint32 domain)`
- `rescueERC20(address tokenContract, address to, uint256 amount)`
- `rescuer() view returns (address)`
- `setFeeRecipient(address _feeRecipient)`
- `setMinFee(uint256 _minFee)`
- `setMinFeeController(address _minFeeController)`
- `transferOwnership(address newOwner)`
- `unDenylist(address account)`
- `updateDenylister(address newDenylister)`
- `updateRescuer(address newRescuer)`

Not on Ethereum's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Optimism's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Unichain's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Unichain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Monad's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `initialize`. Do not call them there: a program compiled for Monad is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Sonic's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Sonic is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `initialize`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Linea's tokenMessenger (`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Linea is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base Sepolia's tokenMessenger (`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Base Sepolia is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc Testnet's tokenMessenger (`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`), whose code does not dispatch them or declares them otherwise: `initialize`. Do not call them there: a program compiled for Arc Testnet is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum Sepolia's tokenMessenger (`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`), whose code does not dispatch them or declares them otherwise: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController`. Do not call them there: a program compiled for Ethereum Sepolia is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

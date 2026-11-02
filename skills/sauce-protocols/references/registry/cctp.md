<!-- Generated from the SDK's registries. Do not edit. -->

# CCTP (`cctp`)

Circle's Cross-Chain Transfer Protocol (v2) — permissionless native USDC bridging that burns on the source chain and mints on the destination domain, with configurable finality and fee.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Cctp` on ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |
| Document | [cctp.md](../cctp.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cctp` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's tokenMessenger, `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Optimism](../../../sauce-chains/references/optimism.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Unichain](../../../sauce-chains/references/unichain.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Polygon](../../../sauce-chains/references/polygon.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Monad](../../../sauce-chains/references/monad.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Sonic](../../../sauce-chains/references/sonic.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arc](../../../sauce-chains/references/arc.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Base](../../../sauce-chains/references/base.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Linea](../../../sauce-chains/references/linea.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `initialize` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger`; not on this deployment: `getMinFeeAmount`, `initialize`, `MIN_FEE_MULTIPLIER`, `minFee`, `minFeeController`, `setMinFee`, `setMinFeeController` |

## ABI

### `TokenMessengerABI`

`import TokenMessengerABI from "./protocols/cctp/TokenMessengerABI.json";` Speaks for: tokenMessenger. The import is the contract's full ABI across every deployment; call it through the `Cctp` namespace to have a function a chain's deployment does not run refused.

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

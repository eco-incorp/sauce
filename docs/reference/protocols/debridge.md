<!-- Generated from the SDK's registries. Do not edit. -->

# deBridge (`debridge`)

> deBridge is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Debridge` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### bridge

Create a cross-chain order via DLN (DeBridge Liquidity Network).

```typescript
import { DlnSourceABI as IDlnSource } from "./abis";

function main(
  dlnSourceAddress: Address,
  giveToken: Address,
  giveAmount: Uint256,
  takeToken: bytes,
  takeAmount: Uint256,
  takeChainId: Uint256,
  receiver: bytes,
): Uint256 {
  const dln = IDlnSource.at(dlnSourceAddress);
  return dln.createOrder(
    {
      giveTokenAddress: giveToken,
      giveAmount: giveAmount,
      takeTokenAddress: takeToken,
      takeAmount: takeAmount,
      takeChainId: takeChainId,
      receiverDst: receiver,
      givePatchAuthoritySrc: ctx.msgSender(),
      orderAuthorityAddressDst: receiver,
      allowedTakerDst: 0x00,
      externalCall: 0x00,
      allowedCancelBeneficiarySrc: 0x00,
    },
    0x00,
    0,
    0x00,
  );
}
```

- `giveToken`: ERC-20 token address to send on source chain
- `giveAmount`: Amount of source token to send
- `takeToken`: Token address on destination chain (as bytes, since it may be on a non-EVM chain)
- `takeAmount`: Minimum amount to receive on destination. Set slightly below `giveAmount` to account for market maker spread
- `takeChainId`: Destination chain ID (uses EVM chain IDs)
- `receiver`: Recipient address on destination chain (as bytes)
- `givePatchAuthoritySrc`: Address allowed to increase give amount (set to `msg.sender`)
- `orderAuthorityAddressDst`: Address that can cancel/modify order on destination (set to `receiver`)
- `allowedTakerDst`: Restrict which market maker can fill (empty `0x00` = any taker)
- `externalCall`: Optional calldata to execute on destination after fill
- `allowedCancelBeneficiarySrc`: Restrict who receives refund on cancellation (empty `0x00` = order creator)
- Requires ERC-20 approval to DlnSource

## Notes

- Intent/order-based architecture: users create orders specifying desired outcome, market makers compete to fill
- Uses EVM chain IDs for destination (unlike LayerZero/Wormhole which use their own IDs)
- Same DlnSource and DlnDestination addresses deployed across all supported chains
- `takeAmount` should be set slightly below market rate to incentivize market makers
- Supports cross-chain swaps natively (giveToken and takeToken can be different assets)
- `externalCall` enables arbitrary contract execution on destination after the fill
- Finality: typically 1-5 minutes (market maker fills immediately, then settles asynchronously)
- Requires ERC-20 approval to DlnSource for the give token
- TVL: $200M+. Audited
- On Arc (5042) the DLN `globalFixedNativeFee()` is `1000000000000000000` wei, which is 1 USDC: Arc's native coin is USDC at 18 decimals, paid from the same balance as the USDC ERC-20 `0x3600…0000` (read 2026-09-28)

## Its names in a program

On Ethereum, `Debridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's dlnDestination, `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f`.
  require(Debridge.DlnDestination != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Ethereum](../chains/ethereum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Optimism](../chains/optimism.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Optimism](../chains/optimism.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [BNB Chain](../chains/bsc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [BNB Chain](../chains/bsc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Polygon](../chains/polygon.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Polygon](../chains/polygon.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Arc](../chains/arc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Arc](../chains/arc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Base](../chains/base.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Base](../chains/base.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Arbitrum One](../chains/arbitrum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Arbitrum One](../chains/arbitrum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Avalanche C-Chain](../chains/avalanche.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Avalanche C-Chain](../chains/avalanche.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |

## ABI

### `DlnDestinationABI`

`import DlnDestinationABI from "./protocols/debridge/DlnDestinationABI.json";` Speaks for: dlnDestination.

- `fulfillOrder((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority) payable`

### `DlnSourceABI`

`import DlnSourceABI from "./protocols/debridge/DlnSourceABI.json";` Speaks for: dlnSource.

- `createOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope) payable returns (bytes32 orderId)`

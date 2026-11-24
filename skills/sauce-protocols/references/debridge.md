# deBridge

Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.

## Category

bridge + cross-chain trading | Direction: any-to-any | Chains and addresses: [registry/debridge.md](registry/debridge.md)

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
      givePatchAuthoritySrc: ctx.self(),
      orderAuthorityAddressDst: receiver,
      allowedTakerDst: hex``,
      externalCall: hex``,
      allowedCancelBeneficiarySrc: hex``,
    },
    hex``,
    0,
    hex``,
  );
}
```

- `giveToken`: ERC-20 token address to send on source chain
- `giveAmount`: Amount of source token to send
- `takeToken`: Token address on destination chain (as bytes, since it may be on a non-EVM chain)
- `takeAmount`: Minimum amount to receive on destination. Set slightly below `giveAmount` to account for market maker spread
- `takeChainId`: Destination chain ID (uses EVM chain IDs)
- `receiver`: Recipient address on destination chain (as bytes)
- `givePatchAuthoritySrc`: Address allowed to increase the give amount (`patchOrderGive`). The template passes the Pot (`ctx.self()`), which is the order's maker; not whoever called the cook (a relayer, under a signed cook)
- `orderAuthorityAddressDst`: Address on the destination chain that can lower the order's take amount (`patchOrderTake`) and cancel it there (`sendEvmOrderCancel`), naming who is refunded on the source chain (with `allowedCancelBeneficiarySrc` empty, any address). The template keeps `receiver`, the party on the destination chain: the Pot exists there only if its owner deploys it on that chain, and a non-EVM destination cannot name it at all
- `allowedTakerDst`: Restrict which market maker can fill (empty ` hex`` ` = any taker)
- `externalCall`: Optional calldata to execute on destination after fill
- `allowedCancelBeneficiarySrc`: Restrict who receives refund on cancellation (empty ` hex`` ` = order creator)
- Requires ERC-20 approval to DlnSource

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/debridge.md](registry/debridge.md).

## Notes

- Order-based architecture: users create orders specifying desired outcome, market makers compete to fill
- Uses EVM chain IDs for destination (unlike LayerZero/Wormhole which use their own IDs)
- Same DlnSource and DlnDestination addresses deployed across all supported chains
- `takeAmount` should be set slightly below market rate to incentivize market makers
- Supports cross-chain swaps natively (giveToken and takeToken can be different assets)
- `externalCall` enables arbitrary contract execution on destination after the fill
- Finality: typically 1-5 minutes (market maker fills immediately, then settles asynchronously)
- Requires ERC-20 approval to DlnSource for the give token
- TVL: $200M+. Audited
- On Arc (5042) the DLN `globalFixedNativeFee()` is `1000000000000000000` wei, which is 1 USDC: Arc's native coin is USDC at 18 decimals, paid from the same balance as the USDC ERC-20 `0x3600…0000` (read 2026-09-28)

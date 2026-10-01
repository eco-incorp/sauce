<!-- Generated from the SDK's registries. Do not edit. -->

# deBridge (`debridge`)

Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Document | [debridge.md](../debridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's dlnDestination):

```sauce chain=ethereum
import DlnDestinationABI from "./protocols/debridge/DlnDestinationABI.json";

const DLN_DESTINATION = 0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn;

function main() {
  const bound = DlnDestinationABI.at(DLN_DESTINATION);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Arc](../../../sauce-chains/references/arc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Arc](../../../sauce-chains/references/arc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Base](../../../sauce-chains/references/base.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Base](../../../sauce-chains/references/base.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |

## ABI

### `DlnDestinationABI`

`import DlnDestinationABI from "./protocols/debridge/DlnDestinationABI.json";` Speaks for: dlnDestination.

- `fulfillOrder((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority) payable`

### `DlnSourceABI`

`import DlnSourceABI from "./protocols/debridge/DlnSourceABI.json";` Speaks for: dlnSource.

- `createOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope) payable returns (bytes32 orderId)`

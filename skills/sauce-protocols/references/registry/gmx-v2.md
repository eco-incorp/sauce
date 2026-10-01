<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V2 (`gmx-v2`)

Next generation of GMX perpetual exchange with isolated markets, improved risk management, and GM liquidity tokens replacing GLP.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [gmx-v2.md](../gmx-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's exchangeRouter):

```sauce chain=arbitrum
import ExchangeRouterABI from "./protocols/gmx-v2/ExchangeRouterABI.json";

const EXCHANGE_ROUTER = 0x7dE39FF2e232A2203196788d37e234cF8F1b83f1n;

function main() {
  const bound = ExchangeRouterABI.at(EXCHANGE_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | dataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `ExchangeRouterABI.at(0x7dE39FF2e232A2203196788d37e234cF8F1b83f1n)` |

## ABI

### `ExchangeRouterABI`

`import ExchangeRouterABI from "./protocols/gmx-v2/ExchangeRouterABI.json";` Speaks for: exchangeRouter.

- `createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params) payable returns (bytes32 orderKey)`
- `cancelOrder(bytes32 key) payable`
- `sendTokens(address token, address receiver, uint256 amount) payable`

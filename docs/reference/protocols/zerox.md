<!-- Generated from the SDK's registries. Do not edit. -->

# 0x Protocol (`zerox`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> 0x Protocol is an exchange aggregator: it routes a swap across many exchanges. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Zerox` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## What it offers

- **transformERC20**: Execute a token swap via the Exchange Proxy transformer pipeline

## Notes

- The Exchange Proxy address is the same on 6 of its 7 chains; Optimism's differs
- Uses transformer pipeline architecture - each swap is a sequence of transformations
- Route computation happens via 0x API - transformations array comes from API response
- Approve inputToken to exchangeProxy before swapping
- 0x API provides the route, slippage protection, and transformer calldata

## Its names in a program

On Ethereum, `Zerox` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's exchangeProxy, `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`.
  require(Zerox.ExchangeProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Optimism](../chains/optimism.md) | exchangeProxy | `0xDEF1ABE32c034e558Cdd535791643C58a13aCC10` | `Zerox.ExchangeProxy` |
| [BNB Chain](../chains/bsc.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Polygon](../chains/polygon.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Base](../chains/base.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Arbitrum One](../chains/arbitrum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Avalanche C-Chain](../chains/avalanche.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## ABI

### `ExchangeProxyABI`

`import ExchangeProxyABI from "./protocols/zerox/ExchangeProxyABI.json";` Speaks for: exchangeProxy. The import is the contract's full ABI across every deployment; call it through the `Zerox` namespace to have a function a chain's deployment does not run refused.

- `_transformERC20((address taker, address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations, bool useSelfBalance, address recipient) args) payable returns (uint256 outputTokenAmount)`
- `createTransformWallet() returns (address wallet)`
- `getFunctionImplementation(bytes4 selector) view returns (address impl)`
- `getQuoteSigner() view returns (address signer)`
- `getTransformerDeployer() view returns (address deployer)`
- `getTransformWallet() view returns (address wallet)`
- `setQuoteSigner(address quoteSigner)`
- `setTransformerDeployer(address transformerDeployer)`
- `transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations) payable returns (uint256 outputTokenAmount)`

Left out of this ABI, though its deployments declare them:

- `FEATURE_NAME` taking `()`: no captured deployment dispatches it.
- `FEATURE_VERSION` taking `()`: no captured deployment dispatches it.
- `migrate` taking `(address)`: no captured deployment dispatches it.
- `transformERC20Staging` taking `(address,address,uint256,uint256,(uint32,bytes)[])`: no captured deployment dispatches it.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

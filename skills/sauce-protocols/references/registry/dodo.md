<!-- Generated from the SDK's registries. Do not edit. -->

# DODO (`dodo`)

Proactive market maker (PMM) DEX with capital-efficient liquidity provision. Features single-token LP, customizable price curves, and smart routing.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Dodo` on ethereum, bsc |
| Chains | ethereum, bsc |
| Document | [dodo.md](../dodo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Dodo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's dodoV2Proxy, `0xa356867fDCeA8e71AEaf87805808803806231FDc`.
  require(Dodo.DODOV2Proxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dodoV2Proxy | `0xa356867fDCeA8e71AEaf87805808803806231FDc` | `Dodo.DODOV2Proxy` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486` | `Dodo.DODOV2Proxy` |

## ABI

### `DODOV2ProxyABI`

`import DODOV2ProxyABI from "./protocols/dodo/DODOV2ProxyABI.json";` Speaks for: dodoV2Proxy.

- `dodoSwapV2TokenToToken(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) returns (uint256 returnAmount)`

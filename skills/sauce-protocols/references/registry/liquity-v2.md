<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V2 (`liquity-v2`)

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV2` on ethereum |
| Chains | ethereum |
| Document | [liquity-v2.md](../liquity-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `LiquityV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's bold, `0x6440f144b7e50D6a8439336510312d2F54beB01D`.
  require(LiquityV2.Bold != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |

## ABI

### `BoldTokenABI`

`import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";` Speaks for: bold.

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`

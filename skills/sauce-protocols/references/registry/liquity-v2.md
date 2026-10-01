<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V2 (`liquity-v2`)

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [liquity-v2.md](../liquity-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's bold):

```sauce chain=ethereum
import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";

const BOLD = 0x6440f144b7e50D6a8439336510312d2F54beB01Dn;

function main() {
  const bound = BoldTokenABI.at(BOLD);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `BoldTokenABI.at(0x6440f144b7e50D6a8439336510312d2F54beB01Dn)` |

## ABI

### `BoldTokenABI`

`import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";` Speaks for: bold.

- `transfer(address to, uint256 amount) returns (bool)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`

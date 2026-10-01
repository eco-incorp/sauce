<!-- Generated from the SDK's registries. Do not edit. -->

# Puffer Finance (`puffer`)

Liquid restaking protocol that issues pufETH. Deposits are natively restaked via EigenLayer for additional yield.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [puffer.md](../puffer.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's pufferVault):

```sauce chain=ethereum
import PufferVaultABI from "./protocols/puffer/PufferVaultABI.json";

const PUFFER_VAULT = 0xD9A442856C234a39a81a089C06451EBAa4306a72n;

function main() {
  const bound = PufferVaultABI.at(PUFFER_VAULT);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `PufferVaultABI.at(0xD9A442856C234a39a81a089C06451EBAa4306a72n)` |

## ABI

### `PufferVaultABI`

`import PufferVaultABI from "./protocols/puffer/PufferVaultABI.json";` Speaks for: pufferVault.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`

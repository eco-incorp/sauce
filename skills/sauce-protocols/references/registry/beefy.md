<!-- Generated from the SDK's registries. Do not edit. -->

# Beefy Finance (`beefy`)

Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Beefy` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [beefy.md](../beefy.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Beefy` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's BIFI, `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1`.
  require(Beefy.BIFI != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | BIFI | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` | `Beefy.BIFI` |
| [Optimism](../../../sauce-chains/references/optimism.md) | BIFI | `0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642` | `Beefy.BIFI` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | BIFI | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` | `Beefy.BIFI` |
| [Polygon](../../../sauce-chains/references/polygon.md) | BIFI | `0xFbdd194376De19A88f4a68671C339563C427310D` | `Beefy.BIFI` |
| [Base](../../../sauce-chains/references/base.md) | BIFI | `0xc55E93C62874D8100dBd2DfE307EDc1036ad5434` | `Beefy.BIFI` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | BIFI | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` | `Beefy.BIFI` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | BIFI | `0xd6070ae98b8069de6B494332d1A1a81B6179D960` | `Beefy.BIFI` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `BeefyVaultABI`

`import BeefyVaultABI from "./protocols/beefy/BeefyVaultABI.json";`

- `deposit(uint256 _amount)`
- `depositAll()`
- `withdraw(uint256 _shares)`
- `withdrawAll()`
- `getPricePerFullShare() view returns (uint256)`
- `balance() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `want() view returns (address)`: the address is a token

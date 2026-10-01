<!-- Generated from the SDK's registries. Do not edit. -->

# Mantle mETH (`mantle-meth`)

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, which accrues staking rewards over time.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `MantleMeth` on ethereum |
| Chains | ethereum |
| Document | [mantle-meth.md](../mantle-meth.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `MantleMeth` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's mETH, `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa`.
  require(MantleMeth.METH != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `MantleMeth.METH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `MantleMeth.Staking` |

## ABI

### `METHABI`

`import METHABI from "./protocols/mantle-meth/METHABI.json";` Speaks for: mETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `METHStakingABI`

`import METHStakingABI from "./protocols/mantle-meth/METHStakingABI.json";` Speaks for: staking.

- `stake(uint256 minMETHAmount) payable`
- `mETHToETH(uint256 mETHAmount) view returns (uint256)`
- `ethToMETH(uint256 ethAmount) view returns (uint256)`

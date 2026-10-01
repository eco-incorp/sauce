<!-- Generated from the SDK's registries. Do not edit. -->

# Mantle mETH (`mantle-meth`)

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, which accrues staking rewards over time.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [mantle-meth.md](../mantle-meth.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's mETH):

```sauce chain=ethereum
import METHABI from "./protocols/mantle-meth/METHABI.json";

const M_ETH = 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfan;

function main() {
  const bound = METHABI.at(M_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `METHABI.at(0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfan)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `METHStakingABI.at(0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8fn)` |

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

<!-- Generated from the SDK's registries. Do not edit. -->

# ether.fi (`etherfi`)

Decentralized, non-custodial liquid restaking protocol. Stake ETH to receive eETH, or wrap it as weETH for DeFi composability.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [etherfi.md](../etherfi.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's eETH):

```sauce chain=ethereum
import EETHABI from "./protocols/etherfi/EETHABI.json";

const E_ETH = 0x35fA164735182de50811E8e2E824cFb9B6118ac2n;

function main() {
  const bound = EETHABI.at(E_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `EETHABI.at(0x35fA164735182de50811E8e2E824cFb9B6118ac2n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `LiquidityPoolABI.at(0x308861A430be4cce5502d0A12724771Fc6DaF216n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `WeETHABI.at(0xCd5fE23C85820F7B72D0926FC9b05b43E359b7een)` |

## ABI

### `EETHABI`

`import EETHABI from "./protocols/etherfi/EETHABI.json";` Speaks for: eETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/etherfi/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `deposit() payable returns (uint256)`

### `WeETHABI`

`import WeETHABI from "./protocols/etherfi/WeETHABI.json";` Speaks for: weETH.

- `wrap(uint256 _eETHAmount) returns (uint256)`
- `unwrap(uint256 _weETHAmount) returns (uint256)`
- `getEETHByWeETH(uint256 _weETHAmount) view returns (uint256)`
- `getWeETHByeETH(uint256 _eETHAmount) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`

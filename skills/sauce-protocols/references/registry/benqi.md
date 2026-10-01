<!-- Generated from the SDK's registries. Do not edit. -->

# Benqi (`benqi`)

Leading lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | avalanche |
| Document | [benqi.md](../benqi.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Avalanche C-Chain's comptroller):

```sauce chain=avalanche
import BenqiComptrollerABI from "./protocols/benqi/BenqiComptrollerABI.json";

const COMPTROLLER = 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4n;

function main() {
  const bound = BenqiComptrollerABI.at(COMPTROLLER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | `BenqiComptrollerABI.at(0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4n)` |

## ABI

### `BenqiComptrollerABI`

`import BenqiComptrollerABI from "./protocols/benqi/BenqiComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] qiTokens) returns (uint256[])`
- `exitMarket(address qiToken) returns (uint256)`

### `QiTokenABI`

`import QiTokenABI from "./protocols/benqi/QiTokenABI.json";`

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`

<!-- Generated from the SDK's registries. Do not edit. -->

# Benqi (`benqi`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Benqi is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Benqi` on avalanche |
| Chains | avalanche |

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also offers sAVAX liquid staking product (separate contract)
- Return values: 0 = success, non-zero = error code
- Avalanche-only deployment. TVL: $500M+. Audited

## Its names in a program

On Avalanche C-Chain, `Benqi` is a namespace: its contracts need no import.

```ts
function main() {
  // Avalanche C-Chain's comptroller, `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`.
  require(Benqi.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Avalanche C-Chain](../chains/avalanche.md) | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | `Benqi.Comptroller` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

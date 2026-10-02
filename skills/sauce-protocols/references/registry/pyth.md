<!-- Generated from the SDK's registries. Do not edit. -->

# Pyth Network (`pyth`)

High-fidelity oracle network providing low-latency price feeds from institutional sources. Uses pull-based model for efficient on-chain price updates.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Pyth` on ethereum |
| Chains | ethereum |
| Document | [pyth.md](../pyth.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Pyth` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's oracle, `0x4305FB66699C3B2702D4d05CF36551390A4c69C6`.
  require(Pyth.Oracle != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | oracle | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` | `Pyth.Oracle` |

## ABI

### `PythOracleABI`

`import PythOracleABI from "./protocols/pyth/PythOracleABI.json";` Speaks for: oracle.

- `updatePriceFeeds(bytes[] updateData) payable`
- `getPrice(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getUpdateFee(bytes[] updateData) view returns (uint256 feeAmount)`

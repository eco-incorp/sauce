# Reflexer

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

## Category

cdp | Chains: Ethereum

## Key Operations

- **exitRai**: Exit RAI from the system (withdraw RAI tokens)
- **joinRai**: Join RAI into the system (deposit RAI tokens)

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/reflexer";
```

## SauceScript Examples

```typescript
// Exit RAI from system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.exit(account, amount);
  return 1;
}

// Join RAI into system
import { CoinJoinABI as ICoinJoin } from "./abis";
function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.join(account, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | rai        | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` |
| Ethereum | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` |
| Ethereum | ethJoin    | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3a` |
| Ethereum | coinJoin   | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` |

## ABI Methods

### SAFEEngineABI

- `modifySAFECollateralization(bytes32,address,address,address,int256,int256)` - Modify SAFE position. Params: collateralType (bytes32 identifier), safe (SAFE owner), collateralSource, debtDestination, deltaCollateral (positive=add, negative=remove), deltaDebt (positive=borrow, negative=repay)
- `safes(bytes32,address)` - Query SAFE position. Params: collateralType, safe address. Returns (lockedCollateral, generatedDebt)

### CoinJoinABI

- `join(address,uint256)` - Join RAI into system (deposit). Params: account, wad (RAI amount, 18 decimals)
- `exit(address,uint256)` - Exit RAI from system (withdraw). Params: account, wad

### ETHJoinABI

- `join(address)` - Join ETH as collateral. Payable (send ETH). Params: account
- `exit(address,uint256)` - Exit ETH collateral. Params: account, wad (ETH amount)

## Notes

- RAI is non-pegged, floating around $3 - NOT a $1 stablecoin
- PID controller adjusts the redemption rate to dampen RAI price volatility
- Inspired by MakerDAO but with a non-pegged design philosophy
- SAFEs (similar to MakerDAO Vaults) hold ETH collateral backing RAI debt
- coinJoin converts between internal system debt units and external RAI ERC-20
- ethJoin converts between ETH and internal collateral accounting

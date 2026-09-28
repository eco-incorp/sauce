# Perpetual Protocol

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

## Category

perpetuals | Chains: Optimism

## Key Operations

- **deposit**: Deposit collateral into Vault for trading
- **withdraw**: Withdraw collateral from Vault
- **openPosition**: Open a leveraged perpetual position
- **closePosition**: Close an existing perpetual position

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce/protocols/perpetual-protocol";
```

## SauceScript Examples

```typescript
// Deposit collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(token, amount);
  return 1;
}

// Withdraw collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.withdraw(token, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Optimism | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` |
| Optimism | vault         | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` |

## ABI Methods

### ClearingHouseABI

- `openPosition((address,bool,bool,uint256,uint256,uint256,uint160,bytes32))` - Open leveraged position. One params struct: baseToken (market), isBaseToQuote (true=short, false=long), isExactInput (true=exact input amount), amount (trade amount), oppositeAmountBound (slippage limit), deadline (tx deadline), sqrtPriceLimitX96 (price limit, 0 for none), referralCode. Returns (base, quote)
- `closePosition((address,uint160,uint256,uint256,bytes32))` - Close position. One params struct: baseToken, sqrtPriceLimitX96 (0 for market), oppositeAmountBound (slippage), deadline, referralCode. Returns (base, quote)
- `getAccountValue(address)` - Get account value. Params: trader. Returns int256 value

### VaultABI

- `deposit(address,uint256)` - Deposit collateral. Params: token (USDC etc.), amount
- `withdraw(address,uint256)` - Withdraw collateral. Params: token, amount
- `getFreeCollateral(address)` - Query available collateral. Params: trader. Returns free collateral amount

## Notes

- Virtual AMM (vAMM) based pricing - no actual liquidity pools
- Cross-margin trading - all positions share the same collateral
- isBaseToQuote: true = short (sell base for quote), false = long (buy base with quote)
- Deposit collateral to Vault first, then trade via ClearingHouse
- sqrtPriceLimitX96 = 0 means no price limit (market order)

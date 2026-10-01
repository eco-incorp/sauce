# Compound V3

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

## Category

lending | Chains and addresses: [registry/compound-v3.md](registry/compound-v3.md)

## SauceScript Functions

### supply

Supply the base asset to earn interest, or supply collateral to enable borrowing.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supply(asset, amount);
  return 1;
}
```

- `cometAddress`: The specific Comet market (e.g. cUSDCv3, cWETHv3)
- `asset`: If base asset (e.g. USDC) -- earns interest. If collateral asset -- enables borrowing
- Requires ERC-20 approval to the Comet address

### withdraw

Withdraw base asset or collateral. If withdrawing more base than supplied, creates a borrow position.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdraw(asset, amount);
  return 1;
}
```

- Withdrawing base asset beyond your supply automatically borrows

### supplyTo

Supply assets on behalf of another address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, dst: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supplyTo(dst, asset, amount);
  return 1;
}
```

- `dst`: Destination address that receives the supply position

### withdrawTo

Withdraw assets to a specific address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, to: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdrawTo(to, asset, amount);
  return 1;
}
```

- `to`: Address that receives the withdrawn tokens

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/compound-v3.md](registry/compound-v3.md).

## Notes

- No separate borrow function -- withdrawing more base than supplied automatically borrows
- Each Comet market has ONE base asset (e.g. USDC) and multiple collateral assets
- No interest rate mode selection -- all borrows are variable rate
- Supply/withdraw of collateral does not earn interest, only the base asset earns
- Market names indicate the base asset: cUSDCv3 = USDC base, cWETHv3 = WETH base
- All supply operations require ERC-20 approval to the Comet address
- TVL: $3.5B+. Audited

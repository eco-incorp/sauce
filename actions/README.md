# @eco-incorp/sauce-actions

Converts high-level routing actions (swaps, bridges, wraps, staking, lending, transfers) into Sauce bytecode for on-chain execution.

## Usage

```typescript
import { actionsToSauce } from '@eco-incorp/sauce-actions';
import type { RoutingAction } from '@eco-incorp/sauce-actions';

const actions: RoutingAction[] = [
  {
    type: 'uniswapV3ExactInput',
    chainId: 1,
    router: '0x...',
    tokenIn: '0x...',
    tokenOut: '0x...',
    fee: 3000,
    amountIn: '1000000000000000000',
    amountOutMin: '900000000',
    recipient: '0x...',
    deadline: Math.floor(Date.now() / 1000) + 3600,
  },
];

const bytecode = actionsToSauce(actions);
```

## Action chaining

Actions can be chained so that the output of one feeds into the next:

- **Implicit chaining** — the output of the previous action automatically becomes the input of the next (when no explicit `amountIn` is set).
- **Named slots** — use `saveOutputAs` / `amountRef` for explicit cross-referencing.

## Building

```bash
npm install
npm run build
```

## Testing

Tests run against a Hardhat fork and require a `FORK_URL` environment variable:

```bash
FORK_URL=https://... npm test
```

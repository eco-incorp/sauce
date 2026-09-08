# Sauce Dev Tools

Development environment for writing and executing SauceScript programs on local or forked Ethereum networks.

## Setup

```bash
pnpm install
```

## Quick Start

```bash
# Start a local Hardhat network with Sauce deployed
npm run start:local

# Or start a forked mainnet (requires FORK_URL env var)
FORK_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY npm run start:fork

# Run a SauceScript
npm run sauce sauce/call.js [arg1] [arg2] ...

# Stop the network
npm run stop
```

## Scripts

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run start:local`  | Start local Hardhat network and deploy Sauce |
| `npm run start:fork`   | Start forked mainnet and deploy Sauce        |
| `npm run stop`         | Stop the running network                     |
| `npm run sauce <file>` | Compile and execute a SauceScript            |
| `npm run build`        | Compile TypeScript                           |

## Writing SauceScript

SauceScript files (`.js`) use JavaScript syntax that compiles to Sauce VM bytecode.

### Basic Example

```javascript
function main() {
  return 42;
}
```

### With Arguments

Arguments are passed as parameters to `main()`:

```javascript
function main(a, b) {
  return a + b;
}
```

Run with: `npm run sauce script.js 10 20`

### Contract Calls

Import ABIs from npm packages and call external contracts:

```javascript
import { IUniswapV3Factory } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";

function main(factoryAddress, token0, token1) {
  const factory = IUniswapV3Factory.at(factoryAddress);
  return factory.getPool(token0, token1, 3000);
}
```

Run with:

```bash
npm run sauce sauce/call.js \
  0x1F98431c8aD98523631AE4a59f267346ea31F984 \
  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

## Arguments

Positional arguments are RUNTIME values for `main`'s parameters. They are appended to the compiled
program as ABI-encoded words, so the program bytes are the same whatever you pass. They parse as:

- Decimal numbers: `123`, `456`, `-1`
- Hex values: `0x1a2b3c...` (over 32 bytes: passed as `bytes`)

A `NAME=VALUE` operand is a COMPILE-TIME define instead: it replaces the module's own `const NAME`
and is constant-folded, so a different value is a different program.

```javascript
const AMOUNT = 0n; // overridden by AMOUNT=4242

function main(a) {
  return a + AMOUNT; // `a` comes from a positional arg
}
```

Run with: `npm run sauce script.js 10 AMOUNT=4242`. The two are told apart by shape — a define's
name is an identifier, which no integer or hex literal can look like — so they may be interleaved.

A define's VALUE is one unsigned 256-bit word. `0x`-hex is passed through as written; any other
spelling JavaScript's `BigInt` reads (decimal, `0b`/`0o`, a leading `+`, leading zeros, surrounding
whitespace) is normalized to decimal, because the compiler's own define grammar accepts only decimal
or `0x`-hex. An empty, all-whitespace, negative, or non-integer value is rejected at the CLI.

## Project Structure

```
dev-tools/
├── scripts/
│   ├── run.ts           # SauceScript runner
│   ├── deploy.ts        # Sauce contract deployment
│   ├── start-local.sh   # Start local network
│   ├── start-fork.sh    # Start forked network
│   └── stop-local.sh    # Stop network
├── src/
│   ├── contracts.ts     # Contract helpers
│   └── runner.ts        # Compilation & execution
├── sauce/
│   ├── js/              # Example SauceScripts (JavaScript)
│   │   ├── add.js
│   │   ├── call.js
│   │   ├── erc20.js
│   │   ├── example.js
│   │   └── fibonacci.js
│   └── ts/              # Example SauceScripts (TypeScript)
│       ├── add.ts
│       ├── call.ts
│       ├── erc20.ts
│       ├── example.ts
│       └── fibonacci.ts
├── test/
│   ├── examples.test.ts # Compilation tests for all examples
│   └── e2e.test.ts      # End-to-end integration tests
└── artifacts/           # Sauce engine contract artifact
```

**Note:** The Sauce contract artifact is loaded from `engine/out/Sauce.sol/Sauce.json`. Run `forge build` in the engine folder if it doesn't exist.

## Requirements

- Node.js 18+
- pnpm

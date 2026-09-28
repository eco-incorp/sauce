# What is actually registered

The SDK carries several registries, and they answer different questions. "Is this protocol in the
catalog?" is not "can I call it by name in a program?", and neither is "is it deployed on my chain?".
Each of the three can be true without the others.

| Registry                         | Current scope                                                                     | Inspect it                                                             |
| -------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Protocol catalog                 | 129 protocols with metadata, deployments, ABI fragments, and program templates    | `listProtocols()`, `getProtocol(slug)`, `getProtocolsByChain(id)`      |
| Contract descriptors             | 30 descriptors across 16 protocol/interface namespaces                            | `contracts.listDescriptors()`, `contracts.listContracts(slug)`         |
| Compiled-source protocol globals | 26 singleton contract leaves across 14 protocol namespaces, plus 5 family aliases | TypeScript completion after importing `@eco-incorp/sauce`; names below |
| Token symbols                    | 5 symbols distributed across 6 EVM chains                                         | `routes.TOKEN_REGISTRY`, `routes.knownTokenSymbols(chain)`             |
| Canonical chain identities       | 40 chains: 39 EVM and Solana                                                      | `CANONICAL_CHAINS`, `requireChain(ref)`                                |
| EVM chain metadata               | 33 records with RPC and explorer information                                      | `chains`, `getChain(id)`, `getAllChainIds()`                           |

The descriptor registry is the one that makes a name callable: it ties a contract name to an ABI and
an address role. `contracts.listDescriptors()` lists them. These associations are curated rather than
derived, which is why the catalog is much larger.

## Protocol globals

These names are available inside compiled EVM route bodies. Availability on the destination chain
is checked during compilation. The declarations describe the vendored ABI surface, which is a
subset of each protocol's complete API.

| Namespace       | Contract leaves                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| `UniswapV2`     | `Factory`, `Router`                                                                   |
| `UniswapV3`     | `Factory`†, `SwapRouter`†, `SwapRouter02`†, `QuoterV2`†, `NonfungiblePositionManager` |
| `UniswapV4`     | `PoolManager`†, `UniversalRouter`, `PositionManager`                                  |
| `SushiswapV2`   | `Factory`, `Router`                                                                   |
| `PancakeswapV2` | `Factory`, `Router`                                                                   |
| `Aerodrome`     | `Router`, `PoolFactory`                                                               |
| `Cctp`          | `TokenMessenger`                                                                      |
| `AaveV3`        | `Pool`                                                                                |
| `AaveV2`        | `LendingPool`                                                                         |
| `Permit2`       | `Permit2`                                                                             |
| `Oneinch`       | `AggregationRouterV6`                                                                 |
| `Pendle`        | `Router`                                                                              |
| `MorphoBlue`    | `Morpho`                                                                              |
| `CompoundV3`    | `CometUSDC`, `CometWETH`, `CometUSDT`                                                 |

† These descriptors have **widened ABI types** whose selectors differ from the deployed contract.
Compilation refuses them by default, with an explanation in `descriptor.coverage.caveats`.
`compile.accessors.allowWidenedSelectors: true` only bypasses that check; it does not repair the
ABI or make the resulting call valid.

Family aliases are `Uniswap`, `Sushiswap`, `Pancakeswap`, `Aave`, and `Compound`. A family exposes
a contract only when exactly one member owns its name. Consequently:

- `Uniswap.UniversalRouter` resolves to `UniswapV4.UniversalRouter`.
- `Uniswap.Factory` is ambiguous; use a versioned namespace.
- `UniswapV3.UniversalRouter` is absent from this registry.
- A family always requires a contract name, even when it has one protocol member.

A protocol with exactly one callable contract also supports a shortcut such as
`Cctp.depositForBurn(...)` or `AaveV3.supply(...)`. See
[protocols and tokens](../guides/protocols-and-tokens.md) for argument conventions and examples.

The four remaining descriptors are available for host-side discovery: `AaveV3.PoolAddressesProvider`
and `MorphoBlue.Bundler3` have addresses but no vendored ABI; `Erc20.ERC20` and
`Erc4626.ERC4626Vault` are unbound interfaces. They are excluded from source globals. Use
`Token(address)` for route-body ERC-20 calls or supply a contract ABI directly to the compiler.

## Tokens

The exported `routes.TOKEN_REGISTRY` contains:

| Chain    | ID    | Symbols                |
| -------- | ----- | ---------------------- |
| Ethereum | 1     | `USDC`, `USDT`, `WETH` |
| Optimism | 10    | `USDC`, `USDT`, `WETH` |
| Polygon  | 137   | `USDC`, `WETH`, `WPOL` |
| Monad    | 143   | `USDC`, `WMON`         |
| Base     | 8453  | `USDC`, `WETH`         |
| Arbitrum | 42161 | `USDC`, `WETH`         |

A missing symbol means the registry has no verified row under that name. Token variants can have
different symbols and addresses. `IntentOptions.tokenDefines` or `SauceCompileOptions.tokens`
can override or add a chain-local mapping. Amounts are integer token units; the compiler does not
apply decimal scaling.

```ts
import { requireChain, routes } from "@eco-incorp/sauce";

const base = requireChain("base");
routes.knownTokenSymbols(base); // ["USDC", "WETH"]
routes.registryTokenAddress(base, "USDC"); // bigint address, or undefined if absent
```

These ERC-20 source globals target EVM. Use the [Solana account and token helpers](../guides/solana.md)
for SPL tokens.

## Host discovery and chain coverage

```ts
import { contracts } from "@eco-incorp/sauce";

const router = contracts.on("base").Uniswap.UniversalRouter;
router.available;
router.address;
router.methods;
router.coverage;

const resolved = contracts.describeContract("base", "uniswap-v4", "UniversalRouter");
const onBase = contracts.contractsOnChain("base");
```

Host accessors such as `Base.Uniswap.UniversalRouter` and `contracts.on(...)` build inert
`ContractCall` objects when their methods are invoked. Those methods are typed `unknown` — their
signatures come from an ABI the type system never sees — so narrow one before calling it. The bare
protocol names _inside_ a compiled program are different: those do have generated ABI method types.

Use `requireChain` for route identities. `getChain` is a separate metadata lookup with RPC and
explorer details, and it covers fewer chains: Unichain, Monad, Sonic, Ronin, Plasma and Ink are
canonical chains with no metadata record.

Three questions, three answers: whether a chain is canonical, whether a protocol is available on it,
and whether a Sauce engine is deployed there. The deployment helpers report recorded addresses — what
your execution path needs is code that is live, which is a read you make.

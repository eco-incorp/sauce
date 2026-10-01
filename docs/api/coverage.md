# What is actually registered

The SDK carries several registries, and they answer different questions. "Is this protocol in the
catalog?" is not "can I call it by name in a program?", and neither is "is it deployed on my chain?".
Each of the three can be true without the others.

| Registry                         | Current scope                                                                  | Inspect it                                                             |
| -------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Protocol catalog                 | 135 protocols with metadata, deployments, ABI fragments, and program templates | `listProtocols()`, `getProtocol(slug)`, `getProtocolsByChain(id)`      |
| Contract descriptors             | 300 descriptors across 135 protocol namespaces                                 | `contracts.listDescriptors()`, `contracts.listContracts(slug)`         |
| Compiled-source protocol globals | The same 135 protocol namespaces, plus 13 family aliases                       | TypeScript completion after importing `@eco-incorp/sauce`; names below |
| Token symbols                    | 7 symbols distributed across 7 EVM chains                                      | `routes.TOKEN_REGISTRY`, `routes.knownTokenSymbols(chain)`             |
| Canonical chain identities       | 41 chains: 40 EVM and Solana                                                   | `CANONICAL_CHAINS`, `requireChain(ref)`                                |
| EVM chain metadata               | 34 records with native-currency and explorer information                       | `chains`, `getChain(id)`, `getAllChainIds()`                           |

Every catalog protocol is a namespace, in a program and in TypeScript: the descriptor registry is
generated from the same binding of addresses to ABIs that the registry's ABI evidence is checked
against, so a contract is exposed exactly as it is evidenced. `contracts.listDescriptors()` lists
them and `contracts.listContracts(slug)` one protocol's.

## Protocol namespaces

A namespace is its protocol's slug in PascalCase, and every one has a contract per registered
deployment role, plus its interfaces. The [contracts reference](contracts.md) has the naming rules
and both surfaces.

| Contract kind     | Count | What it is                                                                    |
| ----------------- | ----- | ----------------------------------------------------------------------------- |
| Deployed contract | 222   | An address per chain and a verified ABI: callable, and its address as a value |
| Address only      | 55    | An address per chain with no verified ABI: usable as an address, no methods   |
| Interface         | 23    | An ABI with no fixed address: called through `.at(address)`                   |

A name existing does not mean the contract is deployed on your chain: `available(...)` in a program
and `.available` in TypeScript answer that, and naming an absent contract fails at compile or call
construction, listing the chains that have it.

Family aliases are `Aave`, `Balancer`, `Compound`, `Euler`, `Gmx`, `Liquity`, `Pancakeswap`,
`Sushiswap`, `Synthetix`, `Synthra`, `Uniswap`, `Unitflow` and `Yearn`. A family exposes a contract
only when exactly one member owns its name. Consequently:

- `Uniswap.UniversalRouter` resolves to `UniswapV4.UniversalRouter`.
- `Uniswap.Factory` and `Pancakeswap.Factory` are ambiguous; use a versioned namespace.
- `UniswapV3.UniversalRouter` is absent from this registry.
- A family always requires a contract name, even when it has one protocol member.

A protocol with exactly one deployed contract also supports a shortcut in programs, such as
`Cctp.depositForBurn(...)` or `AaveV3.supply(...)`.

Every registry ABI declares its contract's deployed types, so its selectors are the deployed ones,
and is a subset of the contract's complete API. A `coverage.caveats` entry records a deployment the
evidence shows differs from its ABI — a bridged token without the L1 token's functions, a function
whose selector is checked but whose source is not verified. `compile.accessors.allowWidenedSelectors`
is still accepted, and no shipped descriptor needs it.

## Tokens

The exported `routes.TOKEN_REGISTRY` contains:

| Chain    | ID    | Symbols                        |
| -------- | ----- | ------------------------------ |
| Ethereum | 1     | `USDC`, `USDT`, `WETH`         |
| Optimism | 10    | `USDC`, `USDT`, `WETH`         |
| Polygon  | 137   | `USDC`, `WETH`, `WPOL`         |
| Monad    | 143   | `USDC`, `WMON`                 |
| Arc      | 5042  | `USDC`, `EURC`, `USYC`, `WETH` |
| Base     | 8453  | `USDC`, `WETH`                 |
| Arbitrum | 42161 | `USDC`, `WETH`                 |

On Arc, `USDC` is the ERC-20 face of the chain's native coin, and `WETH` is bridged ETH rather than
a wrapped native. See [Arc: USDC is the native coin](#arc-usdc-is-the-native-coin).

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

## Arc: USDC is the native coin

Arc (chain 5042) pays gas in USDC, and it has **one USDC balance with two decimal scales**:

| Read through                                               | Scale       | 1 USDC is             |
| ---------------------------------------------------------- | ----------- | --------------------- |
| Native: `msg.value`, `eth_getBalance`, gas                 | 18 decimals | `1000000000000000000` |
| The ERC-20 at `0x3600000000000000000000000000000000000000` | 6 decimals  | `1000000`             |

`getChain(5042).nativeCurrency.erc20` records the ERC-20, and `nativeErc20(chainId)` returns it, or
`undefined` on a chain whose native coin is separate from every token.

- **One balance.** Sending native value and calling `USDC.transfer` move the same money. A Pot that
  bridges its whole `balanceOf(USDC)` and also pays a native fee — a Hyperlane or LayerZero fee,
  the Kitchen's execution fee, deBridge's fixed fee — runs out, because the fee comes from that same
  balance. Leave room for the fee.
- **Dust is invisible to the ERC-20.** `balanceOf` is the native balance divided by 10¹² and rounded
  down, so less than 10¹² wei reads as 0. `nativeToErc20Amount(5042, wei)` converts the same way.
  Compare native and token amounts only after converting one to the other's scale.
- **Every native amount is 18 decimals.** That includes `executionFee`, `execution.value`,
  `nativeAmount` in a route or reward, and a cook's `value`. `1_000_000n` of native value is
  10⁻¹² USDC, not 1 USDC. `Kitchen.executionFee()` read on Arc on 2026-09-28 was
  `10000000000000000`, which is 0.01 USDC.
- **Gas has a 20 gwei floor.** The minimum base fee is 20 gwei, and the mempool silently drops a
  transaction whose `maxFeePerGas` is below it: no error, no receipt. Gas costs
  `gasUsed × gasPrice / 10¹²` in `USDC` token units.
- **There is no canonical wrapped native.** Nothing needs wrapping. `WETH` in the token registry is
  bridged ETH with no `deposit()` or `withdraw()`, and Uniswap's Arc periphery reports a `WETH9()` that
  always reverts, so the ETH paths of those routers revert too. The one WETH9-shaped contract on Arc is
  CCIP's fee token `CCIP_USDC`, which the SDK does not register. Actions `wrapETH`, `unwrapETH`, the
  native ETH stakes, and a `nativeBalance` spent as a token amount are rejected when a program's
  `chainId` is 5042. The deposit builder's `weth` templates reject Arc's `USDC` and registry tokens as
  a target.
- **Native value can be refused.** A value transfer to the zero address, to or from a
  blocklisted address, or to a self-destructed account reverts, including one a contract forwards.
- **A reward offers native value or `USDC`, not both.** Arc's eco-routes Portal treats the native
  coin and the `USDC` ERC-20 as one asset, so an intent reward with a `nativeAmount` and a `USDC`
  token leg reverts `RewardTokensNotUnique(USDC)` when it is published or funded. The SDK refuses
  such a reward when it is built, before anything is signed: fold the two into one leg.

An intent to Arc uses the same Portal, Executor and derived Pot as every other chain; see
[One Portal, one Pot](../guides/intents.md#one-portal-one-pot).

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

Host accessors such as `Base.Uniswap.UniversalRouter` and `contracts.on(...)` build `ContractCall`
objects when their methods are invoked, typed from the contract's ABI, and run them against a viem
client you pass; see the [contracts reference](contracts.md).

Use `requireChain` for route identities. `getChain` is a separate metadata lookup with
native-currency and explorer details, and it covers fewer chains: Unichain, Monad, Sonic, Ronin,
Plasma and Ink are canonical chains with no metadata record.

The SDK ships no RPC endpoints; pass your own. No chain record, Solana cluster or default carries a
URL, and nothing reads one from the environment. Whatever reads a chain takes its connection from
you: a client you construct for the EVM reads, and `rpcUrl` for `createSauceSvmClient`, which throws
naming that option when it is missing.

Three questions, three answers: whether a chain is canonical, whether a protocol is available on it,
and whether a Sauce engine is deployed there. The deployment helpers report recorded addresses — what
your execution path needs is code that is live, which is a read you make.

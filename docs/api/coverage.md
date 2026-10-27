# Coverage

**Reference** · [API reference](README.md) · [Chains](../reference/chains.md) · [Protocols](../reference/protocols.md) · [Tokens](../reference/tokens.md)

> Sauce carries several lists: the protocols it knows about, the names a program can use, and where
> each one is deployed. They answer different questions. This page says which list to ask which
> question.

This page is for a developer who looks a name up from TypeScript and needs to know which list to
ask. [Names and registries](../concepts/names-and-registries.md) explains how a name resolves; this
page lists the registries and the call that inspects each.

"Is this protocol in the catalog?", "can I call it by name in a program?" and "is it deployed on my
chain?" are three questions, and each answer can be yes while the others are no.

| Registry                         | What it holds                                                                                                | Inspect it                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Protocol catalog                 | Each protocol's metadata, deployments, ABI fragments and program templates                                   | `listProtocols()`, `getProtocol(slug)`, `getProtocolsByChain(id)` |
| Contract descriptors             | Each protocol's contracts, every one bound to the ABI the registry's evidence has                            | `contracts.listDescriptors()`, `contracts.listContracts(slug)`    |
| Compiled-source protocol globals | A namespace per catalog protocol, and the family aliases                                                     | TypeScript completion after importing `@eco-incorp/sauce`         |
| Token symbols                    | Each EVM chain's tokens, tokenized stocks included                                                           | `routes.TOKEN_REGISTRY`, `routes.knownTokenSymbols(chain)`        |
| Solana mints                     | Mainnet-beta's mints, tokenized stocks included, devnet's (`solana-devnet`) and testnet's (`solana-testnet`) | `routes.SVM_TOKEN_REGISTRY`, `routes.knownTokenSymbols(chain)`    |
| Canonical chain identities       | Every chain a route can name: the EVM chains, their testnets, and Solana's three                             | `CANONICAL_CHAINS`, `requireChain(ref)`                           |
| EVM chain metadata               | Native currency and explorer, for most EVM chains                                                            | `chains`, `getChain(id)`, `getAllChainIds()`                      |

[Protocols](../reference/protocols.md) lists the catalog by category, each protocol's page its
contracts on every chain; [Tokens](../reference/tokens.md) every chain's symbols and stocks; and
[Chains](../reference/chains.md) every canonical chain, with its metadata where it has a record.

Every catalog protocol is a namespace, in a program and in TypeScript. The descriptor registry is
generated from the same binding of addresses to ABIs that the registry's ABI evidence is checked
against, so a contract is exposed exactly as it is evidenced.

## Protocol namespaces

Every namespace has a contract per registered deployment role, plus its interfaces. The
[contracts reference](contracts.md) has the naming rules and both surfaces.

| Contract kind     | What it is                                                                    |
| ----------------- | ----------------------------------------------------------------------------- |
| Deployed contract | An address per chain and a verified ABI: callable, and its address as a value |
| Address only      | An address per chain with no verified ABI: usable as an address, no methods   |
| Interface         | An ABI with no fixed address: called with one, `Erc4626.Vault(vault)`         |

A name existing does not mean the contract is deployed on your chain: in a program a name the chain
lacks is zero, a test of it (`if (UniswapV3.Factory)`) is decided at compile time, and any other use
of it fails to compile, naming the chain and listing the chains that have it; in TypeScript
`.available` answers, and building a call on an absent contract fails.

Every registry ABI declares its contract's deployed types, so its selectors are the deployed ones,
and is a subset of the contract's complete API. A `coverage.caveats` entry records a deployment the
evidence shows differs from its ABI — a bridged token without the L1 token's functions, a function
whose selector is checked but whose source is not verified. The compile option
`accessors.allowWidenedSelectors` lets a program use a contract whose ABI's selectors do not match
its deployment; no shipped descriptor needs it.

## Tokens

A missing symbol means the registry has no verified row under that name. Token variants can have
different symbols and addresses: Tether's migrated USDT is `USDT0` wherever Tether's own USDT0 list
names its token (Arbitrum and Polygon among them), and those chains register no `USDT`, since the
contract's `symbol()` answers `USD₮0` or `USDT0`. Optimism has both, as two contracts: the bridged
`USDT` and Tether's `USDT0`. `SauceCompileOptions.tokens` can
override or add a chain-local mapping. Amounts are integer token units; the compiler does not
apply decimal scaling.

```ts
import { requireChain, routes } from "@eco-incorp/sauce";

const base = requireChain("base");
routes.knownTokenSymbols(base); // every symbol on Base: "USDC", "WETH" and its tokenized stocks
routes.registryTokenAddress(base, "USDC"); // bigint address, or undefined if absent
```

A row of `routes.TOKEN_REGISTRY` that is a tokenized stock carries `stock`, its issuer, its name
and the underlying's ticker, and `source`, the issuer's list it was copied from. These ERC-20 source
globals target EVM. Use the [Solana account and token helpers](../guides/solana.md) for SPL tokens.

## Arc from TypeScript

Arc (chain 5042) pays gas in USDC, one balance read at two scales: [its page](../reference/chains/arc.md#notes)
has what that changes for a program. From TypeScript, `getChain(5042).nativeCurrency.erc20` records
the ERC-20, and `nativeErc20(chainId)` returns it, or `undefined` on a chain whose native coin is
separate from every token. `nativeToErc20Amount(5042, wei)` converts a native amount to the ERC-20's
scale, rounding down as `balanceOf` does.

The SDK refuses what Arc cannot do before anything is signed: the actions `wrapETH` and `unwrapETH`,
the native ETH stakes and a `nativeBalance` spent as a token amount, when a program's `chainId` is
5042; and the deposit builder's `weth` templates with Arc's `USDC` or a registry token as the
target.

## Solana venues

On Solana, a venue is a program, not a per-chain contract. `Solana.<Venue>` and the root's
`svmVenues` (`svmVenues.venue(slug)`, `svmVenues.venues()`) cover the registered venues only, which
`listVenues()` from `@eco-incorp/sauce/svm` returns:

```ts
import { Solana } from "@eco-incorp/sauce";
import { listVenues } from "@eco-incorp/sauce/svm";

listVenues(); // "raydium-cp-swap", "raydium-amm-v4", "pumpswap", …
Solana.RaydiumCpSwap.programId; // the venue's mainnet program id
```

The `/svm` subpath exports more venue adapters than are registered, each by its own name. An adapter
that is not registered has no `Solana.<Venue>` accessor; import it from `/svm` by name. There is no
pool address book on Solana: a pool's address is always your input. The
[Solana guide](../guides/solana.md#venues-by-namespace) shows the accessors in a swap.

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
native-currency and explorer details, and it covers fewer chains: a chain's
[page](../reference/chains.md) says "not recorded" for a native coin where it has no record.

No import of the package carries an RPC endpoint; pass your own. No chain record, Solana cluster or
default carries a URL, and nothing reads one from the environment. Whatever reads a chain takes its
connection from you: a client you construct for the EVM reads, and `rpcUrl` for
`createSauceSvmClient`, which throws naming that option when it is missing. The `sauce` command is
the one exception: it falls back to public endpoints of its own, which no import can reach.

Whether a Sauce engine is deployed on a chain is a fourth question. The deployment helpers in
`@eco-incorp/sauce/deployments` report recorded addresses, which
[Deployments](../reference/deployments.md) lists. A recorded address is not live code: read the
chain to confirm the code is there before you rely on it.

## Next

[Contracts and tokens](contracts.md) lists the shape of every name these registries give. For the
generated lists themselves, start at [Chains](../reference/chains.md).

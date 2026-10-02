# The Sauce MCP server

[Documentation](../README.md) · [The sauce command](cli.md) · [Agent skills](cli.md#agent-skills)

`sauce mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server. A coding agent
gets the read-only half of the [`sauce` command](cli.md) as tools, and the package's agent skills
as tools and resources. The server compiles programs and action documents and lists a chain's
names. It builds unsigned transactions: the cook, the Pot's deployment, an intent's publish
transactions and each step of its life after. It also rehearses a cook and takes calls apart.

For the initial release it builds transactions only on **Ethereum**, **Base** and **Solana**. Every
other chain is a [preview chain](#supported-and-preview-chains): an agent can compile, simulate and
rehearse any protocol on it, and the tools that would return a transaction there return `refused`
instead, with how to request the chain.

**It never signs, and never asks for a key.** Every transaction comes back unsigned, for a wallet
the user holds. That lets the server run anywhere: on the agent's machine over stdio, or on a host
of your own over Streamable HTTP. Either way, transactions are signed and sent by local means: a
wallet, `cast send`, or `sauce run` with the user's own keystore.

## Run it

One command, through npx. Node.js 24 or newer:

```sh
npx -y @eco-incorp/sauce mcp                                   # stdio: what an agent launches
npx -y @eco-incorp/sauce mcp --http 3000 --config rpc.json     # self-hosted, Streamable HTTP
```

In a project that depends on the package, `npx sauce mcp` runs the project's own version.
`npx sauce mcp --help` lists every flag. The server is loaded only when `sauce mcp` runs, so no
other command pays for it.

Over stdio the server writes nothing but the protocol to stdout. A message larger than `--max-body`
(2 MiB by default) closes the connection.

## Endpoints

A tool that reads a chain takes **`rpcUrl`**, an endpoint for that one call. It looks for an
endpoint in this order:

1. the call's own `rpcUrl`;
2. the server's endpoint for the chain, from `--config <file>` (the
   [`sauce` command's format](cli.md#endpoints-and-signers)):

   ```json
   { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
   ```

3. if neither has one, a plain error naming the chain and saying to pass `rpcUrl`.

The server ships no endpoint and reads no environment variable.

A provider URL usually carries a key, so no URL is ever returned, logged or quoted, from the call
or from the file. That covers results and errors, including an upstream error that repeats the URL.
The file's path is never shown either. The file is checked when the server starts: a malformed
entry, a `<…>` placeholder or a URL that is not http(s) stops it there. `sauce_chains` says which
chains have a server endpoint.

**A server someone else runs sees every `rpcUrl` you pass it.** Pass only keys you are willing to
share with its operator. Otherwise run the server yourself with `npx -y @eco-incorp/sauce mcp`,
where your URL never leaves your machine.

What works with no endpoint at all:

- compiling a program or an action document;
- a chain's names and a price conversion;
- the EVM cook, given its `value`, on a supported chain;
- the Pot's address, and on a supported chain its deployment and an intent's publish transactions;
- taking calldata apart, and reading the skills.

What needs one: `sauce_simulate`, a publish dry run, anything given a transaction hash, a Solana cook
(its blockhash and fee), and reading the Kitchen's fee or whether a Pot exists.

## Add it to a coding agent

`sauce mcp setup` writes the project configuration each agent documents. The server it configures
is launched as `npx -y @eco-incorp/sauce@<this version> mcp`:

```sh
npx sauce mcp setup                                # every agent below
npx sauce mcp setup --agent claude,cursor          # only these
npx sauce mcp setup --config rpc.json              # launch it with --config
```

| Agent                    | File                    | Under                 | Documentation                                                                     |
| ------------------------ | ----------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Claude Code              | `.mcp.json`             | `mcpServers`          | [MCP](https://code.claude.com/docs/en/mcp)                                        |
| OpenAI Codex             | `.codex/config.toml`    | `[mcp_servers.sauce]` | [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)                      |
| Cursor                   | `.cursor/mcp.json`      | `mcpServers`          | [MCP](https://cursor.com/docs/mcp)                                                |
| GitHub Copilot (VS Code) | `.vscode/mcp.json`      | `servers`             | [MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) |
| Gemini CLI               | `.gemini/settings.json` | `mcpServers`          | [MCP servers](https://geminicli.com/docs/tools/mcp-server/)                       |

How setup treats files that already exist:

- It keeps everything else in a file.
- It writes nothing when the entry is already there.
- It leaves a `sauce` entry that differs alone, unless you pass `--force`.
- It leaves a file that is not plain JSON (one with comments) alone too, and prints the entry to
  add.

Each agent asks before it runs a server a project names:

- Claude Code asks you to approve a project server.
- Codex reads `.codex/config.toml` only in a project it trusts.
- VS Code applies Workspace Trust.
- Gemini CLI, with its Trusted Folders setting on, ignores an untrusted folder's settings.

Or add it by hand, with each agent's own command, per its documentation:

```sh
claude mcp add --scope project sauce -- npx -y @eco-incorp/sauce mcp
codex mcp add sauce -- npx -y @eco-incorp/sauce mcp
copilot mcp add sauce -- npx -y @eco-incorp/sauce mcp
```

`codex mcp add` and `copilot mcp add` (the Copilot CLI) write the user's configuration, not the
project's. Cursor has no add command, so write `.cursor/mcp.json`. The entry, for a stdio server:

```json
{
  "mcpServers": {
    "sauce": { "type": "stdio", "command": "npx", "args": ["-y", "@eco-incorp/sauce", "mcp"] }
  }
}
```

```toml
[mcp_servers.sauce]
command = "npx"
args = ["-y", "@eco-incorp/sauce", "mcp"]
```

VS Code's `.vscode/mcp.json` has the same entry under `servers`. Gemini CLI's
`.gemini/settings.json` has it under `mcpServers`, without `type`. An agent can also ask the
server itself: `sauce_install_skills` returns these for the agent it names.

### A remote server

For a server someone runs at `https://<host>/mcp`, behind a token:

```sh
claude mcp add --transport http sauce https://<host>/mcp --header "Authorization: Bearer <token>"
codex mcp add sauce --url https://<host>/mcp --bearer-token-env-var SAUCE_MCP_TOKEN
copilot mcp add --transport http --header "Authorization: Bearer <token>" sauce https://<host>/mcp
```

The same in each agent's file:

- **Claude Code:** `{ "type": "http", "url": …, "headers": { … } }` in `.mcp.json`.
- **Cursor:** `{ "url": …, "headers": { "Authorization": "Bearer ${env:SAUCE_MCP_TOKEN}" } }`.
- **VS Code:** `{ "type": "http", "url": …, "headers": { … } }` under `servers`.
- **Gemini CLI:** `{ "httpUrl": …, "headers": { … } }`. Its `url` means SSE, which this server
  does not serve.

## Tools

Each tool is the `sauce` command named beside it, called with the same inputs: the server calls the
very functions the command does. Each returns its JSON as the tool's structured content, with the
same JSON as text. Where there are `notes`, they say what must be true for a transaction to land.

| Tool                   | Like                   | Returns                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sauce_skills`         | —                      | Every agent skill with when to use it and its files' sizes, and the package version                                                                                                                                                                                                                        |
| `sauce_skill`          | —                      | One skill's `SKILL.md`, or a file under its `references/` or `examples/`; with `section` or `query`, only that part                                                                                                                                                                                        |
| `sauce_dev`            | —                      | For TypeScript against the SDK: the TypeScript skill and the package's guides, API pages and examples for a topic or a question                                                                                                                                                                            |
| `sauce_install_skills` | `sauce skills`         | For one agent, pinned to the server's version: the commands that add the package and install, update and check the skills, where it reads them, and its MCP configuration                                                                                                                                  |
| `sauce_chains`         | —                      | Every chain: slug, id, name, kind, aliases, `support` (`supported` or `preview`) and whether the server has its own endpoint for it; `supported`, the supported slugs; `requestChain`, the chain-support request form                                                                                      |
| `sauce_globals`        | `sauce globals`        | The chain's token symbols, protocol namespaces and contracts (with `protocol`, its methods), chain names, defines and `@sauce/token` functions; `stocks` and `search` for its tokenized stocks, 200 tokens a page (`offset`)                                                                               |
| `sauce_price`          | `sauce price`          | A pair's price as the pool's `sqrtPriceX96` (also the swap's limit) and each direction's `minAvgPrice`; from `price`, `sqrtPriceX96` or a `pool` read now; with `slippageBps`, the `limits`                                                                                                                |
| `sauce_pools`          | `sauce pools`          | Every price-limit pool of a pair on the chain, deepest first: venue, contract, address or V4 key, fee, liquidity, `sqrtPriceX96`, and each direction's price before and with the fee, the distributed swap's `maxPrice` and the depth to a 1% move; `empty`, the pools with no liquidity                   |
| `sauce_compile`        | `sauce compile`        | `bytecode`, `size`, `entryParams`, `entryEncoding`, `entrySchema`, each define it reads and where it came from, the `contracts` it calls, `compiler`, `engine`, on Solana the `manifest`; with `args` the `payload`, and with `rpcUrls` each intent's Pot checked                                          |
| `sauce_actions`        | `sauce actions`        | An actions document (JSON) compiled for a chain: `sauce_compile`'s report with the generated `source`, its `parameters` and bindings, and, given a Pot, the unsigned cook `transaction` (on a preview chain, `refused` instead)                                                                            |
| `sauce_tx`             | `sauce tx`             | EVM `{ chainId, to, data, value }`, the cook on the Pot, with `from` (who signs) and the `kitchenFee` read; Solana `{ chain, via, feePayer, pot, fee, maxExecutionFee, transaction }`, base64 and signed by no one                                                                                         |
| `sauce_pot`            | `sauce pot`            | The Pot's address, its unsigned deployment (EVM `Kitchen.deployPot`; Solana `create_pot`; on a preview chain, `refused` instead), `deployed` (null with no endpoint), and with an endpoint what it holds and the Kitchen's fee                                                                             |
| `sauce_simulate`       | `sauce simulate`       | `ok`, the `path` taken, gas, what `main` returns, transfers, approvals and net balance changes; or the `stage` and `reason` it reverts                                                                                                                                                                     |
| `sauce_intent_publish` | `sauce intent publish` | Each fixed intent's `intentHash`, its `vault`, its `record` (what the other intent tools take) and its unsigned `transactions` (transfers into the vault, then `Portal.publish`; with `intentFundVia: "publishAndFund"`, approvals then `Portal.publishAndFund`); with `dryRun`, their status and `funded` |
| `sauce_intent_fill`    | `sauce intent fill`    | For the solver `from`, its unsigned fill on the destination: approvals, then `fulfillAndProve` (the prover's fee in its value) or `fulfill`; with `dryRun`, the fill rehearsed: the calls and gas, what moved, or the decoded `reason`                                                                     |
| `sauce_intent_import`  | `sauce intent import`  | The intents a source transaction published, each its `record`, vault, block and whether it was funded                                                                                                                                                                                                      |
| `sauce_intent_status`  | `sauce intent status`  | `state`, both sides as read, the deadlines, the prover, and `can`: whether fill, prove, claim, refund and cancel can happen now, why not, and from when                                                                                                                                                    |
| `sauce_intent_prove`   | `sauce intent prove`   | The unsigned `Portal.prove` for one or more fills or cancellations, its bridge fee in its value                                                                                                                                                                                                            |
| `sauce_intent_claim`   | `sauce intent claim`   | The unsigned `withdraw` (`batchWithdraw` for several) that pays each proven intent's claimant                                                                                                                                                                                                              |
| `sauce_intent_refund`  | `sauce intent refund`  | The unsigned `refund` that returns the reward to its creator                                                                                                                                                                                                                                               |
| `sauce_intent_cancel`  | `sauce intent cancel`  | The unsigned `cancel` (or, with `prove`, `cancelAndProve`) that stops an unfilled intent after its route's deadline                                                                                                                                                                                        |
| `sauce_inspect`        | `sauce inspect`        | A cook, Kitchen, Portal or ERC-20 call, or a program, taken apart; with `source`, the arguments decoded against `main`                                                                                                                                                                                     |
| `sauce_verify`         | `sauce verify`         | `valid` with the settle's tokens, `minOut` and recipient, or `valid: false` with the rejection `code`                                                                                                                                                                                                      |

### Supported and preview chains

For the initial release the server builds transactions only on the chains the release supports:
Ethereum, Base and Solana ([Supported chains](../README.md#supported-chains)). Every other chain is a
preview chain. `sauce_chains` gives each chain's `support`, `"supported"` or `"preview"`.

On a preview chain these work as they do everywhere: `sauce_compile`, `sauce_actions`' report,
`sauce_simulate`, `sauce_globals`, `sauce_price`, `sauce_pools`, `sauce_inspect`, `sauce_verify`,
the dry runs (`sauce_intent_publish` and `sauce_intent_fill` with `dryRun`), `sauce_pot`'s
prediction and reads, `sauce_intent_status` and `sauce_intent_import`. So an agent can prototype
any protocol on any chain.

These are refused there, before any endpoint is reached:

- `sauce_tx`, when the program's chain, or the destination of any intent it opens, is a preview
  chain;
- `sauce_intent_publish` without `dryRun`, unless its source and every destination it opens are
  supported (a cascade's later levels are not checked: keep them on supported chains);
- `sauce_intent_fill` without `dryRun`, `sauce_intent_prove` and `sauce_intent_cancel`, by the
  intent's destination; `sauce_intent_claim` and `sauce_intent_refund`, by its source. An intent
  named by `txHash` is read from its source first, then refused by its destination where that is
  the chain the step is sent on.

A refused call is an error result (`isError: true`) whose structured content is the refusal, also
given as its text:

```json
{
  "refused": {
    "code": "preview-chain",
    "action": "building the cook transaction",
    "message": "building the cook transaction is refused: it involves arbitrum (Arbitrum One, chain id 42161), a preview chain. …",
    "supportedChains": [
      { "slug": "ethereum", "id": 1, "name": "Ethereum" },
      { "slug": "base", "id": 8453, "name": "Base" },
      { "slug": "solana", "id": 1399811149, "name": "Solana" }
    ],
    "previewChains": [
      {
        "slug": "arbitrum",
        "id": 42161,
        "name": "Arbitrum One",
        "request": {
          "chain": { "name": "Arbitrum One", "id": 42161, "slug": "arbitrum" },
          "title": "Chain support: Arbitrum One (42161)",
          "searchUrl": "https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Arbitrum+One%22",
          "newIssueUrl": "https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Arbitrum+One+%2842161%29&chain=Arbitrum+One&chain-id=42161",
          "body": "### Chain\n\nArbitrum One\n\n### Chain id\n\n42161\n\n### What you want to run there\n\n…",
          "comment": "Another use case for Arbitrum One (42161):\n\n- What you want to run there: …"
        }
      }
    ]
  }
}
```

`searchUrl` finds the chain-support requests already filed for the chain; `newIssueUrl` opens the
issue form with its title and chain filled in. `body` is the issue as the form would write it, and
`comment` adds one use case to an existing request, each with `<placeholders>` for what the agent
does not know, to post through the user's own GitHub access. The server's instructions tell an
agent to tell the user, offer to find or open that request, and not to build the transaction
another way.

`sauce_pot` on a preview chain returns its prediction (and, with an endpoint, its reads) with
`refused` in place of the deployment's `to`, `data` and `value`. `sauce_actions` given a Pot on a
preview chain returns its report with `refused` in place of `transaction`. Neither is an error.

A revert and a rejected settle are results (`ok: false`, `valid: false`), not errors. An error is a
call that could not be answered: a program that does not compile, an input that is wrong, a chain
that cannot be read. Every input is described in the tool's schema, which `tools/list` returns. An
unknown field is refused, which is how a misspelt one is caught.

The compiling tools take the program as text:

| Input                                                   | Meaning                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `source`                                                | The program, the whole text of a `.sauce.ts` file (at most 256 KiB)                                                                |
| `file`                                                  | Its name, for messages and relative imports (default `program.sauce.ts`)                                                           |
| `modules`                                               | Files it imports by relative path, as path → text from the directory of `file`. Nothing is read from the server's disk             |
| `chain`, `target`                                       | The chain, by slug, alias or id; or a `// @chain` header line in the program. `target: "svm"` alone is Solana                      |
| `defines`                                               | Compile-time values by name: an integer in base units (decimal or `0x` hex), an address, `true` or `false`; a base58 key on Solana |
| `compactArgs`                                           | Encode `main`'s arguments as compact-v1                                                                                            |
| `intentDeadline`, `intentCreator`, `intentExecutionFee` | For intents the program opens: Unix seconds, a `0x` address, wei                                                                   |
| `intentFundVia`                                         | How their reward reaches the vault: `transfer` (default: paid into it, then `publish`) or `publishAndFund`                         |

`sauce_compile` also takes a cook's `args` and `accounts`, to size the payload and, on Solana, the
cook's transaction (with `via`, the Kitchen's or the engine's direct one); and `rpcUrls`, each intent destination's endpoint by chain, to check that the
Pot an intent's cook runs on is deployed there.

A cook (`sauce_tx`, `sauce_simulate`, `sauce_actions`) adds these inputs:

- the Pot: `owner` and `salt` (a label, hashed) or `saltHex` (the salt itself). On an EVM chain the
  Pot can be named by its address as `pot` instead.
- `value` in wei, on an EVM chain. The default is the Kitchen's fee, read from the chain.
- `args`: `main`'s arguments as JSON values, in order. Integers are in base units, as decimal
  strings.
- `accounts`, on Solana: each account `main` takes, by name. Each is an address, `pot` or `owner`.
- `via`, on Solana: `kitchen` (the default), the Kitchen's cook on the owner's Pot, or `engine`,
  the engine's own paid cook with no Kitchen and no Pot: the owner signs as the authority the
  program acts with and pays the fee, and the program's own calls get one more level of CPI depth
  ([Solana guide](solana.md#two-ways-to-run-a-program)).
- `maxExecutionFee` in lamports, on Solana: a cook whose execution fee, read from the cluster, is
  above it is refused before anything is built.
- `rpcUrl`.

`sauce_simulate` also takes:

- `assumeBalance`, such as `["USDC:2", "ETH:0.1"]`: balances the Pot holds for the rehearsal only;
- `fund`, `fundMode` and `sweep`, which rehearse [`sauce run --fund`](cli.md#funding-a-run---fund).
  The Pot is credited what the pulls would bring.

A token amount is whole units (`USDC:1.5`) or base units ending in `n` (`USDC:1500000n`).

`sauce_pot` with an endpoint reads what a cook needs: on an EVM chain the Kitchen's fee (the least
a cook's `value` can be) and the Pot's balance of the native currency and of each token the chain
registers (`null` where a token cannot be read there); on Solana the Pot's associated token account
for each registered mint, whether it exists, and its balance. `balances: false` skips those reads.

`sauce_price` takes the price one of three ways: `price` (a decimal), `sqrtPriceX96`, or `pool`, a
Uniswap V3-style pool of the pair read through an endpoint (its `slot0` price, liquidity and fee).
With `slippageBps`, `limits` gives each direction's `sqrtPriceLimitX96` that far from the price,
and a `minAvgPrice` that also pays the pool's fee (`feePpm`, or the pool's own). A token the chain
does not register is `<address>:<decimals>`, or with an endpoint the address alone: its decimals
are read from the token.

`sauce_pools` takes `chain`, `tokenA` and `tokenB` (each a registered symbol or an address, whose
decimals and symbol are then read from the token), `v4Pools` (more hookless Uniswap V4 keys to
try, each `"<fee>:<tickSpacing>"`), and `rpcUrl`; it needs an endpoint. It returns what
[`sauce pools --json`](cli.md#sauce-pools) prints: `pools`, the ones with liquidity, deepest first,
each with two `sides` (paying `tokenA` for `tokenB`, then the reverse); `empty`; and `checked`,
the tiers, tick spacings and keys each venue was asked for.

`sauce_intent_publish` takes `from` (the wallet that funds the reward), `dryRun`, `assumeBalance`,
`rpcUrl`, and the program inputs, `intentFundVia` among them. The program inputs also take the
reward's deadline and prover: `intentRewardDeadline`
(Unix seconds; the intent's deadline by default) and `intentProver` (the registry's for the pair by
default).

### An intent's life

The server keeps no intents: each call names one, by its `record` — the JSON
`sauce_intent_publish`, `sauce_intent_import` and `sauce_intent_status` return, checked against its
own hash before anything is built from it — or by the transaction that published it, `txHash` with
its source `chain` (and `index` when it published several). `sauce_intent_fill` also takes the
program itself, with the same inputs as `sauce_intent_publish`.

1. `sauce_intent_publish`: the creator's transactions on the source chain. Or `sauce_intent_import`
   for an intent published elsewhere.
2. `sauce_intent_status`: where it stands, and `can`, what can happen next and from when.
3. `sauce_intent_fill` with `from`, the solver: its transactions on the destination. With `dryRun`,
   the same fill rehearsed, from any solver. A fill that proves itself (`fulfillAndProve`) needs no
   step 4.
4. `sauce_intent_prove`: the proof of fills or cancellations, sent from the destination; the
   bridge delivers it to the source's prover.
5. `sauce_intent_claim`: the reward paid to each proven fill's claimant, on the source.

The creator's way back:

- `sauce_intent_refund` returns the reward from the reward's deadline when no one proved a fill, or
  earlier once a proven cancellation is recorded on the source. A source Portal that cannot refuse
  to pay a cancellation is never refunded early.
- `sauce_intent_cancel` stops an unfilled intent after its route's deadline. Anyone may send it,
  and only a destination Portal that can cancel takes it. Prove the cancellation with
  `sauce_intent_prove` once the block it landed in is final (give that block in `cancelledIn`), then
  refund. `prove: true` sends the proof at once, before finality, and the result warns.

For an intent to Solana, the destination's steps — fill, prove and cancel — come back as Solana
transactions: `feePayer` and `transaction`, a base64 wire transaction with every signature in but
the fee payer's. Pass the Solana key that pays and signs as `from`; a fill also needs `claimant`,
the address on the EVM source the reward pays. Sign each with that key, last, and send it within
about a minute, before its blockhash expires. `dryRun` rehearses an EVM destination's fill only;
a Solana fill is rehearsed as it is built. Claim and refund stay on the EVM source.

A step that cannot happen yet is a result, `ready: false` with `why`, not an error. Each tool reads
the chains it needs through `rpcUrls`, each chain's endpoint by slug or id; `rpcUrl` is the endpoint
of the chain the tool names (the source for import, claim and refund, the destination for fill,
prove and cancel). The server's own endpoints fill the gaps.

`sauce_actions` takes the document as `program`, an object or its JSON text, validated against the
[action-program schema](../../actions/action-program.schema.json), also served as
`sauce://actions/schema.json`, and `chain` for a document without a `chainId`. It calls the
function `sauce actions` runs, so its names (tokens by symbol, contracts by namespace) resolve on
that chain as they do for the command.

Error messages and notes are the `sauce` command's, in the tools' words: a flag is named as the
tool input (`--salt-hex` as `saltHex`, `--args` as `args`), and a command line as the tool
(`sauce pot --deploy …` as `sauce_pot`).

### Signing what it builds

The server's transactions are for the user's own wallet. On an EVM chain, `sauce_tx` returns what
any wallet signs. Send it from the Pot's owner, since `cook()` is the owner's alone. From a terminal:

```sh
cast send <to> <data> --value <value> --rpc-url <url> --keystore <keystore>
```

The other transactions:

- `sauce_pot`'s deployment can be sent from any account.
- `sauce_intent_publish`'s transactions go in order, from the wallet that funds the reward: the
  transfers into the vault first, then `publish` once they have landed.
- `sauce_intent_fill`'s go in order from the solver it names (`from`): the Portal pulls what the
  route delivers from the account that calls `fulfill`.
- On Solana, each transaction is signed last by its `feePayer`, the `from` the call named.
- The proof, claim, refund and cancellation can be sent from any account. Each `transactions`
  entry names its `chainId`; the sender pays the gas and the value, and the reward goes to the
  claimant or the creator, never the sender.
- On Solana, `sauce_tx`'s `transaction` is base64, for the owner to sign and send. Its blockhash
  expires in about a minute.

## Skills, documents and prompts

The [agent skills](cli.md#agent-skills) the package ships are the same files `sauce skills install`
copies into a project. They are served two ways, because many clients call tools but never read
resources:

- as tools. `sauce_skills` lists them. `sauce_skill` returns a `SKILL.md`, or a file it links, by
  skill and path; only shipped files are served. `sauce_dev` returns the TypeScript skill and the
  package's own guides, API pages and examples for a topic or a free-text question.
  `sauce_install_skills` says how to install the skills locally for an agent, at the server's
  own version.
- as resources. `sauce://skills/index` lists every skill and its files.
  `sauce://skills/<skill>/SKILL.md` is a skill, and its `references/…` and `examples/…` sit beside
  it.

When a client connects, the server's instructions tell it five things: the server never signs,
start from `sauce_skills`, the steps from `sauce_globals` to `sauce_tx`, which chains it builds
transactions on and what to do with a refusal, and how `rpcUrl` works. Two prompts walk the main tasks through the
tools, with the skill they start from embedded:

- `sauce_write_program` (`task`, `chain`) writes, compiles, rehearses and builds a program.
- `sauce_open_intent` (`task`, `source`, `destination`) opens a cross-chain intent and builds its
  publish transactions.

## Self-hosting

```sh
npx -y @eco-incorp/sauce mcp --http 3000 --config rpc.json
```

This serves Streamable HTTP at `http://127.0.0.1:3000/mcp`. The server is stateless: every POST
gets a server of its own, answered as JSON, with no session, so any replica can answer any request.
A GET or DELETE is refused (405).

- **No environment, and no key.** The server reads no environment variable. Its RPC endpoints are
  the `--config` file's alone, and it holds no key: nothing it builds is signed.
- **It authenticates no one.** Bound to loopback, the default, it answers only requests whose
  `Host`, and `Origin` when one is sent, is a loopback name. That keeps a web page from reaching it
  through DNS rebinding.
- **Off loopback it needs `--allowed-host`.** For a deployment others reach, bind it with `--host`
  and name the host it is served as with `--allowed-host` (repeatable). It refuses to start
  without one. `--allowed-host '*'` answers any `Host`, for a proxy that checks it itself.
- **Put your own authentication in front.** Use a reverse proxy that checks a token (or OAuth)
  before forwarding to it, and that rate-limits, since every chain read spends your endpoints'
  quota.

```sh
npx -y @eco-incorp/sauce mcp --http 3000 --host 0.0.0.0 --allowed-host mcp.example.com \
  --config rpc.json
```

**Callers' endpoints are guarded.** Over HTTP, a caller's `rpcUrl` is chosen by whoever calls, so
the server reaches it only through a guard:

- It takes `https:` only.
- It resolves the host and refuses any address that is loopback, private (RFC 1918, ULA),
  link-local, CGNAT, reserved or a cloud metadata service.
- It resolves and checks the host again at every connection, so a name that changes to a private
  address after the check (DNS rebinding) is refused when used.
- It follows no redirect, and times out.
- It bounds what it sends and what it reads back.

`--allow-private-rpc` lets callers reach `http:` and private addresses, for a deployment inside a
private network. Link-local and metadata addresses stay refused. Over stdio there is no guard: the
server is the user's own process, reached by the user's own agent, so an endpoint it names (a local
node included) is one the user can already reach.

A request body over `--max-body` bytes (2 MiB by default) is refused with 413 before it is read.
Each tool bounds its own inputs as well: 256 KiB of program, 32 modules, 64 arguments, defines or
accounts, and 1 MiB of hex.

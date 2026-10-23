# Signed cooks

**How-to guide** · [Documentation](../README.md) · [Wallets and signing](cli-wallets.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)

> Normally you send the cook that runs a program on your Pot yourself. With a signed cook you sign
> it instead, like signing a cheque, and hand it to someone else: a relayer who pays the gas, a
> service that sends it later, a second account of yours. Your Pot runs exactly the program you
> signed, with the arguments, deadline and fee ceiling you signed, and nothing else.

This page is for an owner who wants another account to send their cooks, and for the account that
sends them. It needs the `sauce` command and a wallet ([Wallets and signing](cli-wallets.md)), or
the package in a TypeScript project. Signed cooks run on EVM chains, on a Private Pot created by the
current Kitchen. What the Pot checks is explained under
[Signed cooks](../concepts/kitchen-pot-cook.md#signed-cooks).

## Sign a cook

Take the quick start's program, `pay.sauce.ts`, which pays USDC from your Pot. Sign the cook that
runs it, with your wallet as the Pot's owner:

```sh
sauce sign pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

The command compiles the program, appends `main`'s arguments, reads the chain, and signs:

- **The Pot** is your own, as for `sauce run`. `--pot <address>`, or `--owner <address>` with
  `--salt`, names another; the signer must be its owner.
- **The value** the sender must send is `--value <wei>`, 0 unless you say otherwise.
- **The fee ceiling** is the Kitchen's fee now, read from the chain. `--max-fee <wei>` signs a higher
  one, so the cook still runs if the fee rises.
- **The nonce** is random, so two signatures you hand out never collide. `--nonce <n>` picks one.
- **The deadline** is an hour from the chain's latest block. `--within <seconds>` signs a shorter
  or longer one, `--deadline <unix seconds>` an exact one; give one or the other.
- **The submitter** is anyone. `--submitter <address>` lets only that account send it.

Before signing, the command checks that the Pot takes signed cooks. If the Pot has no code yet, it
still signs, and adds the Pot's deployment for the sender to send first. A Pot named only by
`--pot` with no code, a Pot created before signed cooks, and a Shared Pot are refused, with the
reason. `--offline` reads nothing, so it then needs `--max-fee`.

### What it prints

It prints this JSON on stdout, with `--json` or without, and its notes on stderr either way, the
fee warning among them (abbreviated here):

```text
{
  "chainId": 8453,
  "pot": "0x…", "owner": "0x…", "engine": "0x…",
  "program": "0x…",
  "value": "0", "maxExecutionFee": "10000000000000",
  "nonce": "83017…", "deadline": "1792700000", "submitter": "0x0000000000000000000000000000000000000000",
  "typedData": { "domain": { … }, "types": { … }, "primaryType": "Cook", "message": { … } },
  "digest": "0x…",
  "signature": "0x…",
  "cook": { "chainId": 8453, "to": "0x…", "data": "0x…", "value": "0x0" }
}
```

| Field                                                                                             | What it is                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pot`, `owner`, `engine`, `program`, `value`, `maxExecutionFee`, `nonce`, `deadline`, `submitter` | What was signed. The amounts, the nonce and the deadline are decimal strings.         |
| `typedData`                                                                                       | The EIP-712 typed data, as `eth_signTypedData_v4` takes it                            |
| `digest`                                                                                          | The 32-byte hash the signature is over                                                |
| `signature`                                                                                       | The owner's signature                                                                 |
| `cook`                                                                                            | The transaction the sender sends: to the Pot, `cookSigned(…)`, with exactly `value`   |
| `deployPot`                                                                                       | Only while the Pot has no code: its deployment, for any account to send before `cook` |

The notes say who may send it and until when, the Kitchen's fee now beside the ceiling and what
the Pot holds to pay it, and how to cancel it. Anyone who holds the output can send `cook` until the
deadline, so hand it only to the account you mean.

## Send it from another account

The sender needs only `cook`: its `to`, `data` and `value`. Any wallet sends it, from any account,
unless the cook names a submitter, and the sender pays the gas. Send exactly `value`: the Pot
checks the value it receives against the signed one, and refuses any other amount.

The sender does not pay the Kitchen's fee: the Pot pays it from its own balance, which includes the
value sent. A Pot that holds no native coin needs a signed value that covers the fee, and a note
warns when the balance and the value together are below the fee now.

When `deployPot` is there, send it first; any account may. To sign the transactions with a key kept
elsewhere, send what the signer returns with `sauce send`, which simulates each, sends it and
reports what it did:

```sh
sauce send 0x02f8…deploy 0x02f8…cook --rpc-url <url>
```

A cook that reverts leaves the signature unused: send it again, before the deadline.

## Sign with a wallet kept elsewhere

Without a signer, `sauce sign` signs nothing. It prints the same fields without `signature` and
`cook`, and `typedData` is what to hand your wallet's `eth_signTypedData_v4`:

```sh
sauce sign pay.sauce.ts --chain base --owner <owner> --args <recipient> 1000000 --json
```

Sign `typedData` there, then run the same command again with the signature. Give it the
`--max-fee`, `--nonce` and `--deadline` the first run printed, so it builds the same cook:

```sh
sauce sign pay.sauce.ts --chain base --owner <owner> --max-fee <maxExecutionFee> --nonce <nonce> --deadline <deadline> --args <recipient> 1000000 --signature <signature>
```

It checks the signature against the owner and builds `cook`. An owner that is a contract, such as
a Safe or an EIP-7702 account, signs through its own `isValidSignature`, which the command asks on
chain. A signature that does not verify is refused.

## Cancel a signature

A signature you no longer want runs until its deadline unless you cancel it. Cancel it by its
nonce, from the owner:

```sh
sauce sign --cancel <nonce> --chain base --wallet me
```

`--cancel` repeats, for several nonces at once. It sends one `invalidateNonces(word, mask)` to the
Pot for each word of nonces, and prints the hashes. Without a signer (`--owner <owner>` or
`--pot <address>`), it prints the transactions unsigned, for the owner's wallet to sign and
`sauce send` to send. A cancelled nonce stays cancelled.

## In the MCP server

The MCP server builds the same. `sauce_signed_cook` signs nothing and runs on every server: it is
`sauce sign` without a signer, with `signature` to check one made elsewhere, and `cancel` to build
cancellations. On a local server with wallets, `sauce_sign` signs with one of them, and
`sauce_wallet_send` sends `cook`, or a cancellation, from any wallet.
[The MCP server's tools](mcp-tools.md) lists their inputs.

## In TypeScript

`@eco-incorp/sauce/evm/engine` builds each piece; your wallet signs. With a viem wallet client
`wallet` and public client `client` for Base:

```ts
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import {
  checkSignedCookPot,
  cookNonceMasks,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookTypedData,
  verifySignedCook,
} from "@eco-incorp/sauce/evm/engine";
import { getAddress } from "viem";

const check = await checkSignedCookPot(client, pot);
if (!check.ok) throw new Error(check.reason); // not a Pot, Shared, or created before signed cooks

const cook = {
  chainId: 8453,
  pot,
  engine: getAddress(v12EngineAddress()),
  program, // the bytecode with main's arguments appended
  value: 0n,
  maxExecutionFee, // at least the Kitchen's executionFee() now
  nonce: randomCookNonce(),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
};

// The owner signs.
const signature = await wallet.signTypedData({ account: owner, ...signedCookTypedData(cook) });
if (!(await verifySignedCook({ ...cook, signature, owner: check.owner }, client))) {
  throw new Error("not the owner's signature");
}

// Anyone sends this, with exactly `value`.
const { to, data, value } = encodeCookSigned({ ...cook, signature });

// The owner cancels it: one call per word of nonces.
const cancellations = cookNonceMasks([cook.nonce]).map(({ word, mask }) => ({
  to: pot,
  data: encodeInvalidateNonces(word, mask),
}));
```

`signedCookTypedDataJson` gives the same typed data as JSON, for a wallet that is not viem, and
`signedCookDigest` the hash. `cookNonceWordBit(nonce)` says which word and bit a nonce sets, and
`cookNonceUsed(client, pot, nonce)` reads whether it is spent. The runnable
[signed-cook.ts](../examples/signed-cook.ts) signs `pay.sauce.ts` with a throwaway key, verifies
the signature and encodes both calls, offline.

## Stay safe

A signed cook is a cheque: whoever holds it can cash it, once, until it expires.

### Replay

Each nonce runs once. A cook that reverts spends nothing, so the same signature can be sent again
until its deadline, by anyone who has it. Once sent, it is public: it is in the transaction's
calldata for anyone to read. The nonce's record lives in the Pot's storage, which a program you cook
can write, so a program can clear a spent nonce and let a signature that has not expired run again.
Cook only programs you have read, sign short deadlines, and cancel what you no longer want.

### Expiry

The deadline is the last second it runs, inclusive, compared with the block's timestamp. Sign the
shortest deadline the sender needs: a signature that has expired is worth nothing to anyone who
copied it.

### Naming the submitter

With no submitter, anyone holding the signature may send it, and may do so before the account you
meant, at a moment of their choosing up to the deadline. Name the account with `--submitter` when
only one should send it. The submitter is the Pot's immediate caller: through a bundler or a
forwarding contract, it is that contract, not the account behind it.

### Cancelling nonces

`sauce sign --cancel <nonce>` sets the nonce's bit, and no signature for it runs after that. The Pot
itself may cancel too, so a signed cook whose program cancels others lets a relayer pay for your
cancellation. A cancellation that lands after the cook has already run changes nothing.

### The fee ceiling

The Kitchen's owner sets the fee, and may raise it after you sign. Your Pot pays at most the signed
ceiling, and a cook whose fee is above the ceiling, or above what the Pot holds, reverts and can be
sent again once the fee is back under it. Sign a ceiling you are willing to pay.

### Wallet spending limits

A [spending limit](cli-wallets.md#put-a-spending-limit-on-a-wallet) on native coin or a token
refuses to sign a cook, naming the limit. A wallet's limits are measured by simulating the
transaction before it is sent, and a signed cook is sent by someone else, at any time up to its
deadline, on whatever the chain holds then: a simulation when you sign says nothing of what it will
move, and a day's total cannot count a cook that may never land. A policy that sets only `chains`
and `to` still applies: the chain, and the Pot as the address. A wallet with no policy signs.

### Old and Shared Pots

A Pot created before signed cooks keeps its code and has no `cookSigned`: a signed cook sent to it
reverts, and the command refuses to sign for it. Sign for a Pot created by the current Kitchen
instead. A Shared Pot has no owner and refuses every signed cook. A Private Pot with a fixed Router
takes them.

On Solana there is nothing to sign apart from the transaction: the Kitchen's cook takes the owner's
signature and a separate fee payer, so `sauce sign` refuses Solana.

## Next

- How a Pot checks a signed cook: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md#signed-cooks).
- Wallets, policies and signing with a key kept elsewhere: [Wallets and signing](cli-wallets.md).
- What to check before a program spends real money: the [production checklist](production-checklist.md).

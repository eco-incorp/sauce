// @sauce/intents — EVM arm.
//
// What `Chain.Portal.send({ ... }).then(() => { ... })` lowers to. The SDK encodes the intent itself, with
// viem, at the call site (`routes/intent-host.ts`): `data` is the Portal's `publish` (or
// `publishAndFund`) calldata, with each value the enclosing program knows only at run time already
// written into it. These functions fund the reward and publish it, in the one cook, so the vault
// they pay cannot disagree with the intent the Portal records.
//
// `rewards` is the reward's token entries in order, 64 bytes each: the token's word, then its
// amount's. A token listed more than once is funded once, for the largest of its amounts: that is
// the balance the Portal checks each entry of it against. `native` is the native amount's word.
import { approve, transfer } from "@sauce/token";

// The largest amount `rewards` lists for the token of entry `i`, or 0 when an earlier entry has the
// same token — so each distinct token is funded once, at its first entry.
function largestAt(rewards: bytes, i: Uint256): Uint256 {
  const token = rewards.slice(i * 64n, i * 64n + 32n).toBe();
  const entries = rewards.length / 64n;
  let largest = 0n;
  let first = 1n;
  for (let j = 0n; j < entries; j = j + 1n) {
    const other = rewards.slice(j * 64n, j * 64n + 32n).toBe();
    const amount = rewards.slice(j * 64n + 32n, j * 64n + 64n).toBe();
    if (other == token && j < i) {
      first = 0n;
    }
    if (other == token && amount > largest) {
      largest = amount;
    }
  }

  return largest * first;
}

// Pay the reward into the intent's vault, then `publish`. The vault is read from the Portal over
// the very bytes about to be published: `intentVaultAddress` takes `publish`'s arguments, so the
// query is `data` with `vaultSelector` in place of its selector. Each token moves with SafeERC20
// semantics; an amount of zero moves nothing.
export function publish(
  portal: Address,
  data: bytes,
  vaultSelector: bytes,
  rewards: bytes,
  native: bytes,
): void {
  const query = vaultSelector.concat(data.slice(4n, data.length));
  const [vault] = abi.decode(evm.static(portal, query), ["Address"]);
  const entries = rewards.length / 64n;
  for (let i = 0n; i < entries; i = i + 1n) {
    const amount = largestAt(rewards, i);
    if (amount > 0n) {
      transfer(rewards.slice(i * 64n, i * 64n + 32n).toBe(), vault, amount);
    }
  }
  const value = native.toBe();
  const empty = hex``;
  if (value > 0n) {
    evm.call(vault, value, empty);
  }
  evm.call(portal, 0n, data);
}

// Approve the Portal for the reward, then `publishAndFund` with the native amount as value: the
// Portal pulls the reward into the vault itself. `approve` resets a standing allowance first, which
// matters here, because one Pot publishes every intent on a chain.
export function publishAndFund(portal: Address, data: bytes, rewards: bytes, native: bytes): void {
  const entries = rewards.length / 64n;
  for (let i = 0n; i < entries; i = i + 1n) {
    const token = rewards.slice(i * 64n, i * 64n + 32n).toBe();
    const amount = largestAt(rewards, i);
    const repeat = rewards.slice(i * 64n + 32n, i * 64n + 64n).toBe();
    if (amount > 0n || repeat == 0n) {
      approve(token, portal, amount);
    }
  }
  evm.call(portal, native.toBe(), data);
}

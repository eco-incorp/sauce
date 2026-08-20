// @sauce/token — SVM arm (SPL Token).
// Selected by the compiler for `--target svm`. Reads are a byte-range `svm.sload` into the SPL
// account layout; writes are a `svm.call` CPI into the SPL Token program, which each write requires
// by identity. Accounts are passed as
// `Account` slots; the token's own identity (`token`) is a plain address value (the mint pubkey).
//
// Pinning `.owner` to legacy SPL Token (`Tokenkeg…`) means a **Token-2022** (`TokenzQd…`) account is
// now refused by every function here, where the reads used to accept one — its first 165 bytes carry
// the same layout. Deliberate: the writes already pin their callee to `Tokenkeg…`, so accepting
// Token-2022 on the read path would let one program's accounts be read and never written.
//
// Every function requires `<account>.owner` to be the SPL Token program before it reads an SPL layout
// out of an account. The layout checks below say what the bytes claim to be; the owner says who was
// allowed to write them, and only the owning program may. Without it a hand-assembled account with the
// right bytes at the right offsets reads exactly like a genuine one.
//
// SPL token-account layout: mint@0 (pubkey), amount@64 (u64 LE), delegate COption tag@72 (u32 LE:
// 0 = None, 1 = Some), delegate@76 (pubkey), delegated_amount@121 (u64 LE).
// SPL mint layout: supply@36 (u64 LE), decimals@44 (u8). Instruction tags: Transfer=3, Approve=4.
// The SPL Token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA) is an `Account` the caller
// attaches, like every other: `svm.call`'s callee is named by the slot it occupies, so it rides in as
// `tokenProgram` and reaches the manifest under that name. Which account arrives there is the
// caller's choice, so each write `require`s that it is the SPL Token program — the same shape as the
// mint check beside it, and the reason `Account` compares for identity.

export function balanceOf(token: Address, account: Account): Uint256 {
  require(account.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(svm.sload(account, 0, 32).toBe() == token);
  return svm.sload(account, 64, 8).toLe();
}

// These two read the **mint**, and the owner check is weaker for them than for the reads above: the
// SPL Token program owns mints *and* token accounts, so `token.owner == Tokenkeg…` passes for either.
// A token account attached where a mint belongs puts bytes 36..44 inside its `owner` field — which
// whoever assembled the transaction chose — so `totalSupply` returns a number they picked, and
// `decimals` reads byte 44 of the same field.
//
// Separating the two needs the account's data **length** (a mint is 82 bytes, a token account 165),
// and nothing in the language reads it: `svm.sload` past the end reverts, which cannot be caught, and
// there is no length primitive. So the check narrows the attack to real SPL-owned accounts and no
// further. `balanceOf`/`allowance` are not exposed this way — their `mint`@0 comparison pins the
// account's own layout, which a mint would fail.
export function totalSupply(token: Account): Uint256 {
  require(token.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  return svm.sload(token, 36, 8).toLe();
}

export function decimals(token: Account): Uint256 {
  require(token.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  return svm.sload(token, 44, 1).toLe();
}

export function allowance(token: Address, account: Account, spender: Address): Uint256 {
  require(account.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(svm.sload(account, 0, 32).toBe() == token);
  // The delegate is a `COption<Pubkey>`: read `delegated_amount` only when the tag is `Some` (1)
  // *and* the delegate matches `spender`. spl-token leaves the delegate bytes stale after `Revoke`,
  // so the tag must gate the pubkey compare — else a revoked delegate would still match.
  if (svm.sload(account, 72, 4).toLe() == 1 && svm.sload(account, 76, 32).toBe() == spender) {
    return svm.sload(account, 121, 8).toLe();
  }
  return 0;
}

// The writes enforce the named asset the same way the reads do: `require` the source ATA's `mint`@0
// equals `token`, so a caller can't attach an account of the wrong mint. `source` only, matching the
// reads and for the same reason: `dest` is the CPI's to validate, and the genuine SPL processor does. Two documented cross-target
// divergences (see README's cross-target divergences ledger): (1) the `u64` amount guard — SPL
// amounts are `u64`, so an infinite-approve (`2^256 - 1`) reverts here while it succeeds on the EVM
// (`uint256`); (2) the mint check reverts on a wrong `token`, where the EVM read arm returns 0 for a
// codeless/wrong address — an error-path divergence, not a value one.
export function transfer(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void {
  require(tokenProgram == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(source.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(svm.sload(source, 0, 32).toBe() == token);
  require(amount <= 0xffffffffffffffff);
  let data = hex`03`;
  svm.call(tokenProgram, [source, dest, authority], data.concat(amount.toBytesLe(8)));
}

// SPL has no separate delegated-transfer instruction: `Transfer` (tag 3) covers both the owner and
// the delegate moving funds, and which one it is follows from the `authority` the caller attaches —
// so `transferFrom` IS `transfer` here, and delegates to it rather than repeating the CPI. (The EVM
// arm keeps two distinct methods because ERC20 genuinely has two: `transfer` moves the caller's
// balance, `transferFrom` spends an allowance.)
export function transferFrom(token: Address, tokenProgram: Account, source: Account, dest: Account, authority: Account, amount: Uint256): void {
  transfer(token, tokenProgram, source, dest, authority, amount);
}

// `approve` sets a single SPL delegate on `source` (SPL tracks one delegate per account, so a second
// approve overwrites the first) — the EVM's `approve` writes a per-spender allowance map, so this
// arm and `allowance` are single-delegate where the EVM is per-spender (a documented divergence).
export function approve(token: Address, tokenProgram: Account, source: Account, delegate: Account, authority: Account, amount: Uint256): void {
  require(tokenProgram == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(source.owner == 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9);
  require(svm.sload(source, 0, 32).toBe() == token);
  require(amount <= 0xffffffffffffffff);
  let data = hex`04`;
  svm.call(tokenProgram, [source, delegate, authority], data.concat(amount.toBytesLe(8)));
}

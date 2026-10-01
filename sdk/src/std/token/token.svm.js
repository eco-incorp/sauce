// @sauce/token — SVM arm (SPL Token and Token-2022).
// Selected by the compiler for `--target svm`. Reads are a byte-range `svm.sload` into the SPL
// account layout; writes are a `svm.call` CPI into a token program, which each write requires by
// identity. Accounts are passed as `Account` slots; the token's own identity (`token`) is a plain
// address value (the mint pubkey).
//
// TWO TOKEN PROGRAMS. A mint, and every token account of it, is owned by the legacy SPL Token program
// (`Tokenkeg…`) or by Token-2022 (`TokenzQd…`). Token-2022 keeps the legacy layouts as its base and
// appends extensions after them, so one set of offsets reads both:
//   - every read (`balanceOf`, `ownerOf`, `allowance`, `totalSupply`, `decimals`) takes an account
//     owned by either program;
//   - the checked writes (`transferChecked`, `approveChecked`) CPI into whichever of the two owns the
//     accounts — the `TransferChecked`/`ApproveChecked` instructions, which carry the mint and its
//     decimals and which both programs implement. Token-2022 refuses the plain `Transfer` for a mint
//     whose extensions need the mint to move it (a transfer fee, a transfer hook, a pause), so a
//     program that moves Token-2022 tokens uses these;
//   - the plain writes (`transfer`, `transferFrom`, `approve`) are unchanged: they CPI the legacy
//     `Transfer`/`Approve` into legacy SPL Token only, and refuse a Token-2022 callee or account.
//
// Every function requires `<account>.owner` to be a token program before it reads an SPL layout out
// of an account. The layout checks below say what the bytes claim to be; the owner says who was
// allowed to write them, and only the owning program may. Without it a hand-assembled account with the
// right bytes at the right offsets reads exactly like a genuine one.
//
// Each check reverts with a reason, so a refused account is named rather than failing in silence:
// "not a token account" (an owner that is no token program, or a Token-2022 account that is not a
// token account), "wrong mint", "not a mint", "uninitialized mint", "not the token program" (the CPI
// callee), "amount over u64" and "transfer hook" (a Token-2022 mint whose transfer hook names a
// program, below). They are short on purpose: a reason is compiled into the program byte for byte,
// and on Solana the program rides in a transaction of at most 1,232 bytes (`transfer`'s four add 65).
//
// SPL token-account layout (`spl_token::state::Account`, `LEN` = 165): mint@0 (pubkey), owner@32
// (pubkey: whose balance it is, a wallet or a PDA such as a Pot), amount@64 (u64 LE), delegate
// COption tag@72 (u32 LE: 0 = None, 1 = Some), delegate@76 (pubkey), state@108 (u8), is_native
// COption@109, delegated_amount@121 (u64 LE), close_authority COption@129.
// SPL mint layout (`spl_token::state::Mint`, `LEN` = 82): supply@36 (u64 LE), decimals@44 (u8), initialized@45 (bool).
// Instruction tags: Transfer=3, Approve=4, TransferChecked=12, ApproveChecked=13.
//
// Token-2022 (`spl_token_2022::extension`): an account with no extensions is exactly the legacy size,
// 82 bytes for a mint and 165 for a token account. An account WITH extensions is longer than 165: a
// mint's 82 bytes are padded to 165, and either way byte 165 is the account type (1 = Mint,
// 2 = Account), followed by the extensions as TLV entries (a u16 type, a u16 length, the value).
// Token-2022 refuses to read a 355-byte account as either, because that is the size of its multisig,
// whose byte 165 falls inside a signer key; so do these checks.
//
// The token program is an `Account` the caller attaches, like every other: `svm.call`'s callee is
// named by the slot it occupies, so it rides in as `tokenProgram` and reaches the manifest under that
// name. Which account arrives there is the caller's choice, so each write `require`s that it is a
// token program — the same shape as the mint check beside it, and the reason `Account` compares for
// identity.

const SPL_TOKEN_PROGRAM = 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;
const TOKEN_2022_PROGRAM = 0x06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc;

// `spl_token::state::Mint::LEN` — the legacy SPL mint's exact size. Exact, not a floor: the legacy
// program's `Pack` refuses any other length for a mint, so every account it ever initialized as one
// is this size and nothing genuine is turned away by requiring it. A floor (`>= 82`) would admit the
// 165-byte token account this exists to reject, since a token account is longer than a mint, not
// shorter. A Token-2022 mint is this size too until it carries an extension.
const SPL_MINT_LEN = 82;

// `spl_token::state::Account::LEN`, and the offset of a Token-2022 account's type byte.
const SPL_ACCOUNT_LEN = 165;

// `spl_token_2022::state::Multisig::LEN`, the one length above 165 that is no extended account.
const SPL_MULTISIG_LEN = 355;

// A token account of `token`, owned by either token program. A legacy SPL Token account is taken on
// its owner, as it always was. A Token-2022 one is 165 bytes, or longer with its type byte (165) set
// to Account (2), and never the multisig's 355; that keeps out a Token-2022 mint, whose first 32
// bytes are its mint authority. Then its mint@0 must be `token`.
//
// The reads share it rather than each repeating it: a function is emitted once however many calls
// reach it, so a program that reads an account twice over (`ownerOf`, then `balanceOf`) carries one
// copy of the checks and their reasons, at the price of a call for a program that reads once.
function requireTokenAccount(token: Address, account: Account): void {
  if (account.owner != SPL_TOKEN_PROGRAM) {
    const size = account.dataLen;
    require(account.owner == TOKEN_2022_PROGRAM &&
      (size == SPL_ACCOUNT_LEN ||
        (size > SPL_ACCOUNT_LEN &&
          size != SPL_MULTISIG_LEN &&
          svm.sload(account, SPL_ACCOUNT_LEN, 1).toLe() == 2)), "not a token account");
  }
  require(svm.sload(account, 0, 32).toBe() == token, "wrong mint");
}

// An initialized mint, owned by either token program: 82 bytes, or a Token-2022 mint longer than 165
// with its type byte set to Mint (1). Owner must be checked before size, and size before the type
// byte, which only an extended account has: each program owns both mints and token accounts, and a
// legacy mint is exactly 82 bytes. Size alone also admits permissionlessly allocated but
// uninitialized accounts, so require the mint's initialization byte before reading its fields.
function requireMint(token: Account): void {
  const size = token.dataLen;
  if (token.owner == TOKEN_2022_PROGRAM) {
    require(size == SPL_MINT_LEN ||
      (size > SPL_ACCOUNT_LEN &&
        size != SPL_MULTISIG_LEN &&
        svm.sload(token, SPL_ACCOUNT_LEN, 1).toLe() == 1), "not a mint");
  } else {
    require(token.owner == SPL_TOKEN_PROGRAM && size == SPL_MINT_LEN, "not a mint");
  }
  require(svm.sload(token, 45, 1).toLe() == 1, "uninitialized mint");
}

export function balanceOf(token: Address, account: Account): Uint256 {
  requireTokenAccount(token, account);
  return svm.sload(account, 64, 8).toLe();
}

// Whose token account this is: its owner@32, a wallet or a PDA such as a Pot. Not `account.owner`,
// which is the program that owns the account's data (a token program, checked first as everywhere
// here), and not the `authority` a write is signed by: SPL accepts the account's delegate there too,
// so a `transfer(…, authority)` that succeeds proves `authority` may spend from `source`, not that
// `source` is `authority`'s. A program measuring its own balance requires
// `ownerOf(token, account) == authority` first. There is no EVM counterpart: an ERC-20 balance has no
// account apart from its holder, so the holder is already the address a program passes.
export function ownerOf(token: Address, account: Account): Address {
  requireTokenAccount(token, account);
  return svm.sload(account, 32, 32).toBe();
}

export function totalSupply(token: Account): Uint256 {
  requireMint(token);
  return svm.sload(token, 36, 8).toLe();
}

export function decimals(token: Account): Uint256 {
  requireMint(token);
  return svm.sload(token, 44, 1).toLe();
}

export function allowance(token: Address, account: Account, spender: Address): Uint256 {
  requireTokenAccount(token, account);
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
export function transfer(
  token: Address,
  tokenProgram: Account,
  source: Account,
  dest: Account,
  authority: Account,
  amount: Uint256,
): void {
  require(tokenProgram == SPL_TOKEN_PROGRAM, "not the token program");
  require(source.owner == SPL_TOKEN_PROGRAM, "not a token account");
  require(svm.sload(source, 0, 32).toBe() == token, "wrong mint");
  require(amount <= 0xffffffffffffffff, "amount over u64");
  let data = hex`03`;
  svm.call(tokenProgram, [source, dest, authority], data.concat(amount.toBytesLe(8)));
}

// SPL has no separate delegated-transfer instruction: `Transfer` (tag 3) covers both the owner and
// the delegate moving funds, and which one it is follows from the `authority` the caller attaches —
// so `transferFrom` IS `transfer` here, and delegates to it rather than repeating the CPI. (The EVM
// arm keeps two distinct methods because ERC20 genuinely has two: `transfer` moves the caller's
// balance, `transferFrom` spends an allowance.)
export function transferFrom(
  token: Address,
  tokenProgram: Account,
  source: Account,
  dest: Account,
  authority: Account,
  amount: Uint256,
): void {
  transfer(token, tokenProgram, source, dest, authority, amount);
}

// `approve` sets a single SPL delegate on `source` (SPL tracks one delegate per account, so a second
// approve overwrites the first) — the EVM's `approve` writes a per-spender allowance map, so this
// arm and `allowance` are single-delegate where the EVM is per-spender (a documented divergence).
export function approve(
  token: Address,
  tokenProgram: Account,
  source: Account,
  delegate: Account,
  authority: Account,
  amount: Uint256,
): void {
  require(tokenProgram == SPL_TOKEN_PROGRAM, "not the token program");
  require(source.owner == SPL_TOKEN_PROGRAM, "not a token account");
  require(svm.sload(source, 0, 32).toBe() == token, "wrong mint");
  require(amount <= 0xffffffffffffffff, "amount over u64");
  let data = hex`04`;
  svm.call(tokenProgram, [source, delegate, authority], data.concat(amount.toBytesLe(8)));
}

// The checked writes, for either token program: `TransferChecked` (12) and `ApproveChecked` (13) name
// the mint as an account and carry its decimals. The callee must be one of the two token programs,
// and the program that owns `source`, `dest` and `mint` — a Token-2022 account is moved by Token-2022
// and a legacy one by legacy SPL Token, never across. `mint` must be `token`; the token program then
// refuses a `source` or `dest` of any other mint, so the asset is pinned without reading either.
// `decimals` must be the mint's own: the token program refuses a mismatch too, but the instruction
// carries one byte, so a value past 255 would wrap onto the mint's and pass, where this refuses it.
//
// What Token-2022's extensions do to a checked write is the token program's, not this library's: a
// transfer fee is withheld from what `dest` receives (a program measures the balance it got, not the
// amount it sent), a paused mint and a frozen account refuse the CPI with the token program's own
// error, and amounts are always raw base units (a scaled UI amount is a display multiplier no program
// sees). The one extension refused here is a transfer hook that names a program: Token-2022 then
// calls that program with the accounts its hook lists, which a fixed list of four cannot carry, so
// the transfer is refused as "transfer hook" before it is attempted. A hook extension with no program
// set is no hook, and transfers as any other mint.
export function transferChecked(
  token: Address,
  tokenProgram: Account,
  source: Account,
  mint: Account,
  dest: Account,
  authority: Account,
  amount: Uint256,
  decimals: Uint256,
): void {
  require(tokenProgram == SPL_TOKEN_PROGRAM ||
    tokenProgram == TOKEN_2022_PROGRAM, "not the token program");
  const program = tokenProgram.address;
  require(source.owner == program && dest.owner == program, "not a token account");
  require(mint.owner == program, "not a mint");
  require(mint == token, "wrong mint");
  require(decimals == svm.sload(mint, 44, 1).toLe(), "wrong decimals");
  require(amount <= 0xffffffffffffffff, "amount over u64");
  // A mint's extensions follow its type byte, each a u16 type, a u16 length and the value.
  // TransferHook (type 14) is its authority, then its program: all zeros is no program. A legacy mint,
  // and a Token-2022 mint with no extensions, are 82 bytes, so the walk never starts. Token-2022 stops
  // at an Uninitialized (0) entry and writes nothing after one; walking on reads only zeros.
  let at = SPL_ACCOUNT_LEN + 1;
  while (at + 4 <= mint.dataLen) {
    const kind = svm.sload(mint, at, 2).toLe();
    require(kind != 14 || svm.sload(mint, at + 36, 32).toBe() == 0, "transfer hook");
    at = at + 4 + svm.sload(mint, at + 2, 2).toLe();
  }
  let data = hex`0c`;
  svm.call(
    tokenProgram,
    [source, mint, dest, authority],
    data.concat(amount.toBytesLe(8)).concat(decimals.toBytesLe(1)),
  );
}

// `ApproveChecked` sets the single delegate on `source`, as `approve` does, for either token program.
// The delegate is any key, not a token account, so only `source` and `mint` are checked. A transfer
// hook runs on transfers only, so an approval needs no walk.
export function approveChecked(
  token: Address,
  tokenProgram: Account,
  source: Account,
  mint: Account,
  delegate: Account,
  authority: Account,
  amount: Uint256,
  decimals: Uint256,
): void {
  require(tokenProgram == SPL_TOKEN_PROGRAM ||
    tokenProgram == TOKEN_2022_PROGRAM, "not the token program");
  const program = tokenProgram.address;
  require(source.owner == program, "not a token account");
  require(mint.owner == program, "not a mint");
  require(mint == token, "wrong mint");
  require(decimals == svm.sload(mint, 44, 1).toLe(), "wrong decimals");
  require(amount <= 0xffffffffffffffff, "amount over u64");
  let data = hex`0d`;
  svm.call(
    tokenProgram,
    [source, mint, delegate, authority],
    data.concat(amount.toBytesLe(8)).concat(decimals.toBytesLe(1)),
  );
}

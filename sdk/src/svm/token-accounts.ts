/**
 * One Solana mint as a `@sauce/token` write takes it, resolved per mint: the accounts a cook attaches
 * for it and the amounts it moves.
 *
 * A mint belongs to legacy SPL Token or to Token-2022, and so does every token account of it. Which
 * one is the mint's OWNER (`token-program.ts`), so this reads the mint through an
 * `OwnedAccountLoader`: the data alone cannot tell an extensionless Token-2022 mint from a legacy one.
 * The program is three things to a cook:
 *   - the `tokenProgram` account a write CPIs into (`transferChecked`, `approveChecked`, which
 *     require it to own the source, the destination and the mint);
 *   - the program a token account's associated address derives under, so `svmTokenAccount` gives a
 *     Token-2022 holder's account where a legacy derivation gives an address nothing created;
 *   - the program whose extensions (`token-extensions.ts`) decide what a transfer delivers.
 *
 * A checked write takes the mint as an account and its decimals as an argument; both are here. A
 * transfer fee withholds part of what is sent, so `svmTokenReceived` and `svmTokenToSend` net it the
 * way Token-2022 does, to the unit, at the epoch the transfer lands in.
 */
import type { Address } from "@solana/kit";
import { associatedTokenAccount } from "./portal.js";
import {
  classifyMintProgram,
  isToken2022Mint,
  SPL_MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
} from "./token-program.js";
import { grossTransferAmount, netTransferAmount, parseMintExtensions } from "./token-extensions.js";
import type { MintExtensions } from "./token-extensions.js";
import type { OwnedAccountLoader } from "./venues/types.js";

/** A mint's base: decimals@44 and is_initialized@45, the same in both programs. */
const MINT_DECIMALS = 44;
const MINT_INITIALIZED = 45;
/** Token-2022's multisig size, which it never reads as a mint whatever its type byte says. */
const MULTISIG_LEN = 355;

export interface SvmToken {
  readonly mint: Address;
  /** The program that owns the mint: legacy SPL Token or Token-2022. A write's `tokenProgram`. */
  readonly tokenProgram: Address;
  /** The mint's decimals: a checked write's `decimals` argument. */
  readonly decimals: number;
  /** The mint's Token-2022 extensions; none for a legacy mint. */
  readonly extensions: MintExtensions;
  /**
   * Why a checked transfer of this mint is refused, empty when it is not: a transfer hook that names
   * a program (`@sauce/token` refuses it as "transfer hook": the hook's own accounts are not passed),
   * and every extension `extensions.blocking` lists (a paused mint, a non-transferable one, accounts
   * that start frozen).
   */
  readonly transferRefusals: readonly string[];
}

/**
 * Reads `mint` and resolves it: its token program, decimals and extensions. Throws when the account
 * is missing, is owned by neither token program, or is not an initialized mint.
 */
export async function resolveSvmToken(load: OwnedAccountLoader, mint: Address): Promise<SvmToken> {
  const account = await load(mint);
  if (account === null) throw new Error(`svm token: mint ${mint} account not found`);
  const tokenProgram = classifyMintProgram(mint, account.data, account.owner);
  const { data } = account;
  // The shape `@sauce/token`'s `decimals` requires: 82 bytes, or an extended Token-2022 mint.
  const shaped =
    data.length === SPL_MINT_SIZE ||
    (tokenProgram === TOKEN_2022_PROGRAM_ID &&
      isToken2022Mint(data) &&
      data.length !== MULTISIG_LEN);
  if (!shaped || data[MINT_INITIALIZED] !== 1) {
    throw new Error(`svm token: ${mint} is not an initialized mint`);
  }
  const extensions = parseMintExtensions(data);
  const hook = extensions.transferHook;

  return {
    mint,
    tokenProgram,
    decimals: data[MINT_DECIMALS]!,
    extensions,
    transferRefusals: [
      ...(hook === undefined
        ? []
        : [
            `TransferHook names program ${hook.programId}, whose extra accounts a checked transfer does not pass`,
          ]),
      ...extensions.blocking,
    ],
  };
}

/** `owner`'s associated token account for the mint, under the mint's own token program. */
export function svmTokenAccount(
  token: Pick<SvmToken, "mint" | "tokenProgram">,
  owner: Address,
): Promise<Address> {
  return associatedTokenAccount(owner, token.mint, token.tokenProgram);
}

/** What the destination of a transfer of `amount` receives at `epoch`: `amount` less the fee. */
export function svmTokenReceived(token: SvmToken, amount: bigint, epoch: bigint): bigint {
  const fee = token.extensions.transferFee;

  return fee === undefined ? amount : netTransferAmount(amount, fee, epoch);
}

/** What to send at `epoch` for the destination to receive exactly `amount`. */
export function svmTokenToSend(token: SvmToken, amount: bigint, epoch: bigint): bigint {
  const fee = token.extensions.transferFee;

  return fee === undefined ? amount : grossTransferAmount(amount, fee, epoch);
}

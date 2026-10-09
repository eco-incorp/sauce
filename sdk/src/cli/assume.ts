/**
 * `sauce simulate --assume-balance`: what the Pot holds for one rehearsal, put there with state
 * overrides. Nothing is sent and nothing on chain changes.
 *
 * The chain's native currency is the account's balance, overridden as it is. A token's balance is a
 * word in the token's own storage, found by `evm/balance-slot.ts`; this module words its failures
 * for the flag.
 */
import type { Address, PublicClient, StateOverride } from "viem";

import {
  BalanceSlotError,
  balanceOverride,
  findBalanceSlot as findSlot,
  type BalanceSlot,
} from "../evm/balance-slot.js";
import { CliError } from "./args.js";

/** A balance-slot failure as `--assume-balance <label>` reports it. */
function refusal(error: unknown, label: string): unknown {
  if (!(error instanceof BalanceSlotError)) return error;
  const { token } = error;
  switch (error.failure) {
    case "b20":
      return new CliError(
        `--assume-balance ${label}: ${token} is a B20 token, a precompile of the Base node, which ` +
          "keeps its balances where no state override reaches, so a rehearsal cannot give the Pot " +
          "one. Fund the Pot with it instead (--fund), from an account that holds it.",
      );
    case "not-erc20":
      return new CliError(
        `--assume-balance ${label}: ${token} does not answer balanceOf(address), so it is not an ` +
          "ERC-20 the rehearsal can give a balance of",
      );
    case "no-overrides":
      return new CliError(
        `--assume-balance ${label}: the endpoint does not apply state overrides to eth_call, ` +
          "which giving the Pot a balance needs: use an endpoint that does (most do)",
      );
    case "not-stored":
      return new CliError(
        `--assume-balance ${label}: ${error.message.replace(/: its balance is computed.*$/, "")}: ` +
          "a token whose balance is computed rather than stored (rebasing, shares) cannot be " +
          "assumed. Fund the Pot instead.",
      );
    case "write":
      return new CliError(
        `--assume-balance ${label}: ${error.message}, so the balance cannot be assumed`,
      );
  }
}

/**
 * The slot of `token`'s storage holding `holder`'s balance, found with `eth_call` and state
 * overrides and confirmed by `balanceOf`. `label` names the token in a failure.
 */
export async function findBalanceSlot(
  client: PublicClient,
  token: Address,
  holder: Address,
  label: string,
): Promise<BalanceSlot> {
  try {
    return await findSlot(client, token, holder);
  } catch (error) {
    throw refusal(error, label);
  }
}

/**
 * `holder`'s balance of `token`, set to `amount` for a rehearsal: the slot found and the override
 * that writes it, confirmed by `balanceOf` answering exactly `amount` through it.
 */
export async function assumeTokenBalance(
  client: PublicClient,
  token: Address,
  holder: Address,
  amount: bigint,
  label: string,
): Promise<BalanceSlot & { readonly override: StateOverride[number] }> {
  try {
    return await balanceOverride(client, token, holder, amount);
  } catch (error) {
    throw refusal(error, label);
  }
}

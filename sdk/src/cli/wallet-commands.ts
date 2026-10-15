/**
 * `sauce wallet new|list|address|import|export`, and `--wallet <name>` on every command that signs:
 * the wallet directory (`wallets.ts`) as commands, each password read from the one source named on
 * the command line (`password.ts`), and every wallet unlocked guarded by its policy (`policy.ts`).
 *
 * The key never reaches stdout, stderr or a log. `export` alone shows it, and only at a terminal,
 * after the person there types the wallet's name: it writes to the terminal itself, past the
 * scrubbing every other output goes through, so it cannot be piped or captured by an agent.
 */
import { bytesToHex } from "viem";

import { CliError, UsageError, type FlagSpecs } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { describeSource, readPassword, type PasswordIo, type PasswordSource } from "./password.js";
import { guardWallet, noPolicyNote, readPolicy, type SendGuard } from "./policy.js";
import { secret } from "./signer.js";
import {
  keypairText,
  readImport,
  walletName,
  type Unlocked,
  type WalletInfo,
  type WalletKind,
  type WalletStore,
} from "./wallets.js";

/** The wallet directory, for the wallet commands, `--wallet` and `sauce mcp`. */
export const WALLETS: FlagSpecs = {
  wallets: {
    type: "string",
    value: "<dir>",
    optionalValue: true,
    help: "The wallet directory (default: ~/.sauce/wallets)",
  },
};

/** Where a wallet's or a keystore's password comes from: one of these, else a prompt. */
export const PASSWORD: FlagSpecs = {
  "password-env": {
    type: "string",
    value: "<NAME>",
    help: "The password is the environment variable NAME (only that one is read)",
  },
  "password-file": {
    type: "string",
    value: "<path>",
    help: "…or a file only you can read (else it is asked for)",
  },
  "password-command": {
    type: "string",
    value: "<command>",
    help: "…or what this command prints (a secret manager's CLI)",
  },
};

/** What the wallet commands need from the process. */
export interface WalletIo extends PasswordIo {
  readonly stderr: (text: string) => void;
  /** All of stdin, to its end. */
  readonly readStdin: () => string;
  /** Asks for a line of text at the terminal; `undefined` where there is none. */
  readonly ask?: (question: string) => Promise<string | undefined>;
  /** Writes to the terminal itself, never to stdout; false where there is none. */
  readonly writeTerminal?: (text: string) => boolean;
}

/** What every result about a wallet says. */
export const HOT_WALLET =
  "This is a hot wallet: whoever holds its file and its password holds the key. Keep only small " +
  "balances in it.";

const walletJson = (info: WalletInfo, hasPolicy: boolean): Record<string, unknown> => ({
  name: info.name,
  kind: info.kind,
  address: info.address,
  path: info.path,
  policy: hasPolicy ? info.policyPath : null,
});

/** Whether `info` has a policy file, read (and checked) the way a send reads it. */
function policyState(info: WalletInfo): { readonly has: boolean; readonly note?: string } {
  try {
    return { has: readPolicy(info) !== undefined };
  } catch (error) {
    return { has: true, note: `warning: ${(error as Error).message}` };
  }
}

/**
 * The wallet `name`, unlocked with `password` — and guarded from now on: every send from it passes
 * its policy, which is read (and checked) before the key is decrypted. The policy is returned too:
 * `undefined` when the wallet has none.
 */
export async function openWallet(
  store: WalletStore,
  name: string,
  password: string,
): Promise<{ readonly unlocked: Unlocked; readonly guard: SendGuard }> {
  const info = store.info(name);
  const policy = readPolicy(info);
  const unlocked = await store.unlock(name, password);

  return { unlocked, guard: guardWallet(info, policy) };
}

/** `--wallet <name>`, unlocked with the password `source` gives, and guarded. */
export async function unlockWallet(
  store: WalletStore,
  name: string,
  source: PasswordSource,
  io: Pick<WalletIo, "stderr"> & PasswordIo,
): Promise<Unlocked> {
  // A broken policy fails before the password is asked for.
  readPolicy(store.info(name));
  const password = await readPassword(source, io, { what: `wallet ${name}` });
  const { unlocked, guard } = await openWallet(store, name, password);
  if (guard.policy === undefined) io.stderr(`note: ${noPolicyNote(unlocked.info)}\n`);
  for (const note of guard.policy?.notes ?? []) io.stderr(`note: ${note}\n`);

  return unlocked;
}

/** `sauce wallet new <name> [--solana]`. */
export async function walletNewCommand(
  store: WalletStore,
  input: { readonly name: string; readonly kind: WalletKind; readonly password: PasswordSource },
  io: WalletIo,
): Promise<CommandOutput> {
  walletName(input.name);
  // Before the password is asked for: a name that is taken is refused at once.
  if (store.list().wallets.some((wallet) => wallet.name === input.name)) {
    throw new CliError(
      `wallet ${input.name} exists in ${store.dir}: a wallet is never overwritten`,
    );
  }
  const password = await readPassword(input.password, io, {
    what: `the new wallet ${input.name}`,
    creating: true,
  });
  const { info, warnings } = await store.create(input.name, input.kind, password);

  return created(info, input.password, warnings, "Created");
}

function created(
  info: WalletInfo,
  source: PasswordSource,
  warnings: readonly string[],
  verb: string,
): CommandOutput {
  const policy = policyState(info);

  return {
    text: [
      `${verb} wallet ${info.name} (${info.kind === "evm" ? "EVM" : "Solana"}): ${info.address}`,
      `  file    ${info.path}`,
      `  policy  ${policy.has ? info.policyPath : `none (${info.policyPath} would set limits)`}`,
    ].join("\n"),
    json: walletJson(info, policy.has),
    notes: [
      ...warnings,
      ...(policy.note === undefined ? [] : [policy.note]),
      `Its key is encrypted under the password from ${describeSource(source)}: sign with ` +
        `--wallet ${info.name} and the same password source.`,
      ...(info.kind === "evm"
        ? [`The file is a keystore: --keystore ${info.path} and cast wallet read it too.`]
        : []),
      HOT_WALLET,
    ],
  };
}

/** `sauce wallet list`: names, kinds and addresses, read with no password. */
export function walletListCommand(store: WalletStore): CommandOutput {
  const { wallets, warnings } = store.list();
  const rows = wallets.map((info) => ({ info, policy: policyState(info) }));
  const width = Math.max(4, ...wallets.map((info) => info.name.length));

  return {
    text:
      wallets.length === 0
        ? `No wallets in ${store.dir}: \`sauce wallet new <name>\` creates one.`
        : [
            `Wallets in ${store.dir}:`,
            ...rows.map(
              ({ info, policy }) =>
                `  ${info.name.padEnd(width)}  ${info.kind.padEnd(6)}  ${info.address}` +
                (policy.has ? "  (policy)" : ""),
            ),
          ].join("\n"),
    json: {
      dir: store.dir,
      wallets: rows.map(({ info, policy }) => walletJson(info, policy.has)),
    },
    notes: [
      ...warnings,
      ...rows.flatMap(({ policy }) => (policy.note === undefined ? [] : [policy.note])),
    ],
  };
}

/** `sauce wallet address <name>`. */
export function walletAddressCommand(store: WalletStore, name: string): CommandOutput {
  const info = store.info(name);

  return { text: info.address, json: walletJson(info, policyState(info).has) };
}

/** Whether an operand is a key rather than the path of one: never taken from the command line,
 *  nor from a tool's input. */
export const looksLikeKey = (operand: string): boolean =>
  /^(?:0x)?[0-9a-fA-F]{64}$/.test(operand) ||
  operand.trim().startsWith("[") ||
  operand.trim().startsWith("{") ||
  /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(operand);

/** `sauce wallet import <name> <file | ->`: a key, keystore or keypair read from a file or stdin. */
export async function walletImportCommand(
  store: WalletStore,
  input: {
    readonly name: string;
    readonly from: string;
    /** `--solana`: the key must be a Solana keypair. */
    readonly solana: boolean;
    readonly password: PasswordSource;
  },
  io: WalletIo,
): Promise<CommandOutput> {
  walletName(input.name);
  if (looksLikeKey(input.from)) {
    secret(input.from.trim());
    throw new UsageError(
      "import reads the key from a file, or from stdin (-): a key on the command line lands in " +
        "shell history and the process list",
    );
  }
  if (store.list().wallets.some((wallet) => wallet.name === input.name)) {
    throw new CliError(
      `wallet ${input.name} exists in ${store.dir}: a wallet is never overwritten`,
    );
  }
  let text: string;
  try {
    text = input.from === "-" ? io.readStdin() : io.readText(input.from);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(`${input.from}: ${code === "ENOENT" ? "no such file" : "unreadable"}`);
  }
  secret(text.trim());
  const from = input.from === "-" ? "stdin" : input.from;
  // A keystore is opened with the password, which the wallet then keeps; any other key is
  // encrypted under it.
  const password = await readPassword(input.password, io, {
    what: `the imported wallet ${input.name}`,
    creating: true,
  });
  const imported = readImport(text, password, from);
  try {
    if (input.solana && imported.kind !== "solana") {
      throw new UsageError(`--solana: ${from} holds an EVM key, not a Solana keypair`);
    }
    const { info, warnings } = await store.store(
      input.name,
      imported.kind,
      imported.bytes,
      password,
    );

    return created(info, input.password, warnings, "Imported");
  } finally {
    imported.bytes.fill(0);
  }
}

/**
 * `sauce wallet export <name>`: the key, shown at the terminal after the person there types the
 * wallet's name. Never on stdout, and never without a terminal.
 */
export async function walletExportCommand(
  store: WalletStore,
  input: { readonly name: string; readonly password: PasswordSource },
  io: WalletIo,
): Promise<CommandOutput> {
  const info = store.info(input.name);
  const refusal =
    "export shows a key only at a terminal, to the person there: run it in a terminal of your own";
  if (io.ask === undefined || io.writeTerminal === undefined) throw new CliError(refusal);
  const answer = await io.ask(
    `This shows the private key of wallet ${info.name} (${info.address}) on this terminal. ` +
      `Anyone who sees it controls the wallet.\nType the wallet's name to show it: `,
  );
  if (answer === undefined) throw new CliError(refusal);
  if (answer.trim() !== info.name) throw new CliError("not shown: the name typed does not match");
  const password = await readPassword(input.password, io, { what: `wallet ${info.name}` });
  const { kind, bytes } = store.secretOf(info.name, password);
  try {
    const shown =
      kind === "evm"
        ? `Private key of ${info.address}:\n  ${bytesToHex(bytes)}\n`
        : `Keypair of ${info.address} (the JSON array a keypair file holds):\n  ${keypairText(bytes)}\n`;
    if (!io.writeTerminal(shown)) throw new CliError(refusal);
  } finally {
    bytes.fill(0);
  }

  return {
    text: `Shown on the terminal: wallet ${info.name}'s ${kind === "evm" ? "private key" : "keypair"}.`,
    json: { name: info.name, address: info.address, shown: true },
  };
}

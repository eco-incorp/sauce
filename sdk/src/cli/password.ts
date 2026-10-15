/**
 * Where a keystore's or a wallet's password comes from: exactly one source, named on the command
 * line, or else a prompt at the terminal. There is no `--password <value>` flag — a value on the
 * command line lands in shell history and the process list — and nothing is read implicitly:
 *
 *  - `--password-env <NAME>`: the variable NAME, and no other. THE `sauce` COMMAND'S ONE
 *    DELIBERATE READ OF THE ENVIRONMENT, and only of the variable the user names: an agent's
 *    password lives in its `.env` or its secret store, which hands it to the process that way.
 *  - `--password-file <path>`: the file's text, one trailing newline dropped. A file that others
 *    can read or write is refused, as ssh refuses a private key others can read.
 *  - `--password-command "<command>"`: what the command prints, one trailing newline dropped — a
 *    secret manager's CLI (`pass show sauce`, `op read op://…`, `security find-generic-password
 *    -w …`). It runs with no stdin, and a failure says only its exit status: its output may be the
 *    password, or part of it.
 *  - otherwise a hidden prompt at the terminal, asked twice when a wallet is being created.
 *
 * The local MCP server's `sauce_wallet_enable` names a source too — never the password itself —
 * spelt as its inputs are (`env NAME`, `file <path>`), and never a command: a command the model
 * chose would be a shell for it. It may also name one entry of a `.env` file, which is held to the
 * password file's rule, and every file it names must be a regular one, so a pipe or a device can
 * never hold the server up.
 *
 * The password is registered as a secret (`signer.ts#secret`) the moment it is read, before
 * anything can fail, so no message, log or result can carry it. Node-only, like all of `cli/`.
 */
import { CliError, UsageError } from "./args.js";
import { secret } from "./signer.js";

/** One password source, as the flags give it. */
export type PasswordSource =
  | { readonly from: "env"; readonly name: string }
  | { readonly from: "file"; readonly path: string }
  | { readonly from: "command"; readonly command: string }
  | { readonly from: "prompt" }
  /** `sauce_wallet_enable` only: the entry `name` of the `.env` file at `path`. */
  | { readonly from: "dotenv"; readonly path: string; readonly name: string };

/** Who named a source: a flag of the command line, or the MCP server's `sauce_wallet_enable`. */
export type SourceNamer = "flag" | "tool";

/** The password flags, as given. */
export interface PasswordFlags {
  readonly env?: string | undefined;
  readonly file?: string | undefined;
  readonly command?: string | undefined;
}

/** What reading a password needs from the process. Injected, so each source is tested alone. */
export interface PasswordIo {
  /** The environment variable `name`: the `sauce` command's one read of the environment. */
  readonly readEnv: (name: string) => string | undefined;
  readonly readText: (path: string) => string;
  /** The file's permission bits, `undefined` where the platform has none to check (Windows). */
  readonly fileMode: (path: string) => number | undefined;
  /** Runs `command` through the shell with no stdin, capturing what it prints. */
  readonly capture: (command: string) => CapturedCommand;
  /** Asks for a password without echoing it. Throws where there is no terminal to ask on. */
  readonly promptPassword: (prompt: string) => Promise<string>;
}

/** What `--password-command` did. */
export interface CapturedCommand {
  /** Its exit status; `null` when it did not finish (killed, timed out, never started). */
  readonly status: number | null;
  readonly stdout: string;
  /** Why it did not run, when it did not: `ENOENT`, `ETIMEDOUT`. Never its output. */
  readonly error?: string;
}

/** The shortest password a wallet is created with. */
export const MIN_PASSWORD = 8;

/** What an environment variable's name may be: letters, digits and _, never its value. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The one source `flags` name, or the prompt when they name none. */
export function passwordSource(flags: PasswordFlags): PasswordSource {
  const given = [
    flags.env === undefined ? [] : ["--password-env"],
    flags.file === undefined ? [] : ["--password-file"],
    flags.command === undefined ? [] : ["--password-command"],
  ].flat();
  if (given.length > 1) {
    throw new UsageError(`give one password source, not ${given.join(" and ")}`);
  }
  if (flags.env !== undefined) {
    if (!ENV_NAME.test(flags.env)) {
      throw new UsageError(
        `--password-env takes the NAME of an environment variable (letters, digits and _), not ` +
          "its value",
      );
    }

    return { from: "env", name: flags.env };
  }
  if (flags.file !== undefined) return { from: "file", path: flags.file };
  if (flags.command !== undefined) {
    if (flags.command.trim() === "") throw new UsageError("--password-command is empty");

    return { from: "command", command: flags.command };
  }

  return { from: "prompt" };
}

/**
 * How a source is named in a message: its flag and the variable or file, never a value — or, for
 * a source `sauce_wallet_enable` named, its inputs.
 */
export function describeSource(source: PasswordSource, by: SourceNamer = "flag"): string {
  const flag = by === "flag";
  switch (source.from) {
    case "env":
      return `${flag ? "--password-env" : "env"} ${source.name}`;
    case "file":
      return `${flag ? "--password-file" : "file"} ${source.path}`;
    case "dotenv":
      return `dotenv ${source.path}, variable ${source.name}`;
    case "command":
      // The command itself is not repeated: it may carry an argument someone would rather not see.
      return "--password-command";
    case "prompt":
      return "the terminal";
  }
}

/** One trailing newline, as `echo` and a text editor leave it. */
const withoutNewline = (text: string): string => text.replace(/\r?\n$/, "");

/** Whether permission bits let anyone but the owner read or write. */
const sharedMode = (mode: number): boolean => (mode & 0o077) !== 0;

/** Whether a file's mode is a regular file's (not a pipe, a device or a directory). */
const regularFile = (mode: number): boolean => (mode & 0o170000) === 0o100000;

export interface ReadPasswordOptions {
  /** What it unlocks, for the prompt: "wallet agent". */
  readonly what: string;
  /** A new wallet's: asked twice at a prompt, and held to {@link MIN_PASSWORD}. */
  readonly creating?: boolean;
  /** Who named the source (a flag, by default): how its messages spell it. A file a tool names
   *  must be a regular file. */
  readonly by?: SourceNamer;
}

/** The password `source` gives, registered as a secret before anything else happens to it. */
export async function readPassword(
  source: PasswordSource,
  io: PasswordIo,
  options: ReadPasswordOptions,
): Promise<string> {
  const password = await fromSource(source, io, options);
  const named = describeSource(source, options.by);
  if (password === "") {
    throw new UsageError(`${named} gives an empty password`);
  }
  if (options.creating === true && [...password].length < MIN_PASSWORD) {
    throw new UsageError(
      `${named} gives a password of under ${MIN_PASSWORD} characters: a ` +
        "wallet's password protects its key on disk, so use a longer one",
    );
  }

  return password;
}

async function fromSource(
  source: PasswordSource,
  io: PasswordIo,
  options: ReadPasswordOptions,
): Promise<string> {
  const named = describeSource(source, options.by);
  switch (source.from) {
    case "env": {
      const value = io.readEnv(source.name);
      if (value !== undefined) secret(value);
      if (value === undefined) {
        throw new UsageError(
          `${named}: the variable is not set` +
            (options.by === "tool"
              ? " in this server's environment (the client's configuration passes it, in the " +
                "server entry's env block)"
              : ""),
        );
      }

      return value;
    }
    case "file": {
      const text = readOwnFile(source.path, named, io, options.by === "tool");
      secret(text.trim());
      const password = withoutNewline(text);
      secret(password);

      return password;
    }
    case "dotenv": {
      const value = dotenvEntry(readOwnFile(source.path, named, io, true), source.name);
      if (value === undefined) {
        throw new UsageError(`${named}: the file has no ${source.name} entry`);
      }

      return value;
    }
    case "command": {
      const ran = io.capture(source.command);
      // Whatever it printed is a secret, finished or not: a failure may still have printed it.
      secret(ran.stdout.trim());
      if (ran.status === null) {
        throw new CliError(
          `--password-command did not finish${ran.error === undefined ? "" : ` (${ran.error})`}; ` +
            "its output is not shown",
        );
      }
      if (ran.status !== 0) {
        throw new CliError(
          `--password-command exited with status ${ran.status}; its output is not shown`,
        );
      }
      const password = withoutNewline(ran.stdout);
      secret(password);

      return password;
    }
    case "prompt": {
      const first = await io.promptPassword(`Password for ${options.what}: `);
      secret(first);
      if (options.creating !== true) return first;
      const again = await io.promptPassword(`The same password again: `);
      if (again !== first) throw new CliError("the two passwords differ: nothing was written");

      return first;
    }
  }
}

/**
 * The text of a file that holds a password, refused when anyone but its owner may read or write it
 * — and, when `regular`, when it is not a regular file. Never quoted back.
 */
function readOwnFile(path: string, named: string, io: PasswordIo, regular: boolean): string {
  let mode: number | undefined;
  try {
    mode = io.fileMode(path);
  } catch (error) {
    throw unreadable(named, error);
  }
  if (mode !== undefined && regular && !regularFile(mode)) {
    throw new CliError(`${named} is not a regular file`);
  }
  if (mode !== undefined && sharedMode(mode)) {
    throw new CliError(
      `${named} can be read or written by others (mode ` +
        `${(mode & 0o777).toString(8).padStart(3, "0")}): a password file must be yours ` +
        `alone. Run \`chmod 600 ${path}\`, then try again`,
    );
  }
  try {
    return io.readText(path);
  } catch (error) {
    throw unreadable(named, error);
  }
}

/**
 * Line by line as dotenv reads a `.env` file: `NAME=value`, `export` before it allowed, a value
 * in single, double or back quotes taken whole (`\n` in double quotes a newline) and an unquoted
 * one up to a `#`; the last entry of a name wins. Only `name`'s value is kept, as a secret.
 */
export function dotenvEntry(text: string, name: string): string | undefined {
  const line =
    /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;
  let value: string | undefined;
  for (const match of text.replace(/\r\n?/g, "\n").matchAll(line)) {
    if (match[1] !== name) continue;
    const raw = (match[2] ?? "").trim();
    const unquoted = raw.replace(/^(['"`])([\s\S]*)\1$/, "$2");
    value = raw.startsWith('"') ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r") : unquoted;
  }
  if (value !== undefined) secret(value);

  return value;
}

function unreadable(named: string, error: unknown): CliError {
  const code = (error as { code?: string }).code;

  return new CliError(`${named}: ${code === "ENOENT" ? "no such file" : "unreadable"}`);
}

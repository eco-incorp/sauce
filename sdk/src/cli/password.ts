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
  | { readonly from: "prompt" };

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

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

/** How a source is named in a message: its flag and the variable or file, never a value. */
export function describeSource(source: PasswordSource): string {
  switch (source.from) {
    case "env":
      return `--password-env ${source.name}`;
    case "file":
      return `--password-file ${source.path}`;
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

export interface ReadPasswordOptions {
  /** What it unlocks, for the prompt: "wallet agent". */
  readonly what: string;
  /** A new wallet's: asked twice at a prompt, and held to {@link MIN_PASSWORD}. */
  readonly creating?: boolean;
}

/** The password `source` gives, registered as a secret before anything else happens to it. */
export async function readPassword(
  source: PasswordSource,
  io: PasswordIo,
  options: ReadPasswordOptions,
): Promise<string> {
  const password = await fromSource(source, io, options);
  if (password === "") {
    throw new UsageError(`${describeSource(source)} gives an empty password`);
  }
  if (options.creating === true && [...password].length < MIN_PASSWORD) {
    throw new UsageError(
      `${describeSource(source)} gives a password of under ${MIN_PASSWORD} characters: a ` +
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
  switch (source.from) {
    case "env": {
      const value = io.readEnv(source.name);
      if (value !== undefined) secret(value);
      if (value === undefined) {
        throw new UsageError(`--password-env ${source.name}: the variable is not set`);
      }

      return value;
    }
    case "file": {
      let mode: number | undefined;
      try {
        mode = io.fileMode(source.path);
      } catch (error) {
        throw unreadable(source.path, error);
      }
      if (mode !== undefined && sharedMode(mode)) {
        throw new CliError(
          `--password-file ${source.path} can be read or written by others (mode ` +
            `${(mode & 0o777).toString(8).padStart(3, "0")}): a password file must be yours ` +
            `alone. Run \`chmod 600 ${source.path}\`, then try again`,
        );
      }
      let text: string;
      try {
        text = io.readText(source.path);
      } catch (error) {
        throw unreadable(source.path, error);
      }
      secret(text.trim());
      const password = withoutNewline(text);
      secret(password);

      return password;
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

function unreadable(path: string, error: unknown): CliError {
  const code = (error as { code?: string }).code;

  return new CliError(
    `--password-file ${path}: ${code === "ENOENT" ? "no such file" : "unreadable"}`,
  );
}

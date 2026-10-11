/**
 * Where the `sauce` command asks its questions: a yes/no before a transaction it sends first, a
 * keystore's or a wallet's password, and a line of text (`sauce intent`'s picker and guided
 * creation, `sauce wallet export`'s confirmation).
 *
 * Stdin, while it is a terminal and nothing else has read it. Once a program came through stdin
 * (`sauce run -`), stdin is spent — at its end, or a pipe — so the questions go to the controlling
 * terminal instead, `/dev/tty`, where there is one: a program piped in from a terminal session is
 * still answered at that terminal. With neither there is no one to ask, and the command says so
 * before it sends anything (`commands.ts#unapproved`); it never waits on a stdin that is spent.
 * Windows has no `/dev/tty`, so a program piped in there runs with `--yes` and a password
 * source (`--password-env`, `--password-file`, `--password-command`).
 */
import { closeSync, openSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { ReadStream, WriteStream } from "node:tty";

import { CliError } from "./args.js";

/** A terminal to ask on: what it reads, where its prompts go, and how to let it go. */
export interface Terminal {
  readonly input: NodeJS.ReadableStream & {
    setRawMode?: (mode: boolean) => unknown;
    isTTY?: boolean;
  };
  readonly output: NodeJS.WritableStream;
  readonly close: () => void;
}

/** The controlling terminal, `/dev/tty`, opened for a question; `undefined` where there is none. */
export function controllingTerminal(): Terminal | undefined {
  let readFd: number;
  let writeFd: number;
  try {
    readFd = openSync("/dev/tty", "r");
  } catch {
    return undefined;
  }
  try {
    writeFd = openSync("/dev/tty", "w");
  } catch {
    closeSync(readFd);

    return undefined;
  }
  const input = new ReadStream(readFd);
  const output = new WriteStream(writeFd);

  return {
    input,
    output,
    close: () => {
      input.destroy();
      output.destroy();
    },
  };
}

/** What a terminal is chosen from. Injected, so each case can be tested without one. */
export interface TerminalChoice {
  /** Whether the program was read from stdin, spending it. */
  readonly stdinRead: boolean;
  readonly stdin: Terminal["input"] & { isTTY?: boolean };
  readonly stderr: NodeJS.WritableStream;
  /** Opens the controlling terminal; `undefined` where there is none. */
  readonly controlling: () => Terminal | undefined;
}

/**
 * The terminal to ask on: stdin while it is an unread terminal; the controlling terminal once stdin
 * carried the program; else none. A stdin that is not a terminal and was not read (CI, a pipe the
 * command never reads) asks nothing, as before: the controlling terminal is only the fallback for
 * the stdin the program itself used up.
 */
export function chooseTerminal(choice: TerminalChoice): Terminal | undefined {
  if (choice.stdinRead) return choice.controlling();
  if (choice.stdin.isTTY !== true) return undefined;

  return { input: choice.stdin, output: choice.stderr, close: () => choice.stdin.pause() };
}

/**
 * Writes `text` to the controlling terminal itself — never to stdout, where a pipe or an agent could
 * capture it — or, where there is no `/dev/tty` (Windows), to stdout only while stdout is a
 * terminal. False where there is no terminal at all. What `sauce wallet export` shows a key with.
 */
export function writeToTerminal(text: string): boolean {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "w");
  } catch {
    if (process.platform !== "win32" || process.stdout.isTTY !== true) return false;
    process.stdout.write(text);

    return true;
  }
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }

  return true;
}

/** A yes/no answer typed at `terminal`: yes only for `y`, `yes`, or `deploy`, the word the Pot's
 *  question (`[deploy/cancel]`) offers. */
export function confirmOn(terminal: Terminal, question: string): Promise<boolean> {
  const prompt = createInterface({ input: terminal.input, output: terminal.output });

  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(/^\s*(?:y|yes|deploy)\s*$/i.test(answer));
    });
  });
}

/** A line typed at `terminal`, as typed. */
export function askOn(terminal: Terminal, question: string): Promise<string> {
  const prompt = createInterface({ input: terminal.input, output: terminal.output });

  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer);
    });
  });
}

/** A password typed at `terminal`, echoing nothing. */
export function passwordOn(terminal: Terminal, prompt: string): Promise<string> {
  const input = terminal.input;

  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      terminal.output.write("\n");
    };
    const onData = (chunk: string | Buffer): void => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(typed);

          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new CliError("cancelled"));

          return;
        }
        typed = ch === "\u007f" || ch === "\b" ? typed.slice(0, -1) : typed + ch;
      }
    };
    terminal.output.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
  });
}

/**
 * The files a program compiles from, as a tool call gives them: the program's own text and the
 * modules it imports by relative path. A server over HTTP reads nothing from its own disk — a
 * remote server must not hand its own files to whoever calls it — so the `CliFiles` the commands
 * read through serves only what the call carried. Over stdio, where the caller is the server's own
 * user on the same machine, a call may instead name a program file by `path`, read from disk with
 * its imports as `sauce compile <file>` reads them (`diskProgram`).
 */
import { readFileSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

import { UsageError, type CliFiles } from "./sdk.js";

/** The name a program goes by when the call gives none. */
export const DEFAULT_FILE = "program.sauce.ts";

/** A path a call names: relative, `/`-separated, and inside the program's directory tree. */
function cleanPath(path: string, what: string): string {
  if (path.includes("\0")) throw new UsageError(`${what}: a path holds a NUL byte`);
  const clean = posix.normalize(path.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (clean === "" || clean === "." || clean.startsWith("../") || clean === "..") {
    throw new UsageError(`${what} '${path}' is not a relative path inside the program's tree`);
  }
  if (posix.isAbsolute(clean) || /^[A-Za-z]:/.test(clean)) {
    throw new UsageError(`${what} '${path}' is absolute: give it relative to the program`);
  }

  return clean;
}

/**
 * The program's file name and the `CliFiles` that serve it and its `modules` (keyed by path from
 * the same root as `file`). The commands resolve an import beside the program, against the
 * process's working directory; this answers for exactly the paths the call named, and for nothing
 * else.
 */
export function callFiles(
  file: string | undefined,
  text: string,
  modules: Readonly<Record<string, string>> | undefined,
): { readonly file: string; readonly files: CliFiles } {
  const name = cleanPath(file ?? DEFAULT_FILE, "file");
  const served = new Map<string, string>([[name, text]]);
  for (const [path, source] of Object.entries(modules ?? {})) {
    const key = cleanPath(path, "modules:");
    if (served.has(key)) throw new UsageError(`modules: '${path}' is given twice`);
    served.set(key, source);
  }
  const root = process.cwd();
  const lookup = (path: string): string | undefined => {
    const key = relative(root, resolve(root, path)).split(sep).join("/");

    return served.get(key);
  };
  const encoder = new TextEncoder();

  return {
    file: name,
    files: {
      readText: (path) => {
        const found = lookup(path);
        if (found === undefined) {
          throw Object.assign(new Error(`${path}: not among the files this call gave`), {
            code: "ENOENT",
          });
        }

        return found;
      },
      readModule: (path) => {
        const found = lookup(path);

        return found === undefined ? undefined : encoder.encode(found);
      },
    },
  };
}

/**
 * The program at `path` on this machine — relative to the server's working directory, or absolute —
 * and the `CliFiles` that read it and its relative imports from disk, as the `sauce` command does.
 * Only a server over stdio calls this: its caller is its own user.
 */
export function diskProgram(
  path: string,
  maxLength: number,
): { readonly file: string; readonly text: string; readonly files: CliFiles } {
  if (path.includes("\0")) throw new UsageError("path: a path holds a NUL byte");
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new UsageError(
      `path ${path}: ${code === "ENOENT" ? "no such file" : code === "EISDIR" ? "a directory" : "unreadable"} ` +
        `(read relative to ${process.cwd()})`,
    );
  }
  if (text.length > maxLength) {
    throw new UsageError(`path ${path}: at most ${maxLength} characters`);
  }

  return {
    file: path,
    text,
    files: {
      readText: (file) => readFileSync(file, "utf8"),
      readModule: (file) => {
        try {
          return readFileSync(file);
        } catch (error) {
          const code = (error as { code?: string }).code;
          // Absent is `undefined`, the compiler's resolver contract; anything else propagates.
          if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
          throw error;
        }
      },
    },
  };
}

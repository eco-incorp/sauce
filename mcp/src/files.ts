/**
 * The files a program compiles from, as a tool call gives them: the program's own text and the
 * modules it imports by relative path. Nothing is ever read from the server's disk — a remote
 * server must not hand its own files to whoever calls it — so the `CliFiles` the commands read
 * through serves only what the call carried.
 */
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

/**
 * The operator release gate (`scripts/release-gate.mjs`), run as a whole against a package that is
 * not the real one, to see what it does with its process while it waits: it waits on a chain at
 * every step.
 *
 * A stand-in `npm` "installs" a stand-in package, and the one endpoint the gate is given holds its
 * first request open, so the gate is waiting on a chain when the test acts. The stand-in package's
 * testing kit starts a child the way the real kit starts anvil and its recorder: with no
 * `env` of its own, so with the gate's. That child saw none of the operator's variables, only what
 * a chain needs of them.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/release-gate.mjs");

/** What the operator has in their environment that no child of the gate has any use for. */
const OPERATOR = {
  OPERATOR_CANARY: "operator-canary-3f9a1c7e",
  NPM_TOKEN: "npm_secret_token_value",
  AWS_SECRET_ACCESS_KEY: "aws_secret_value",
  ETH_RPC_URL: "https://live.example.invalid/KEYSEGMENT-0123456789",
};

/** A gate that is waiting on a chain, and what the test can see of it. */
interface Waiting {
  readonly child: ChildProcess;
  /** The gate's exit code (null where a signal ended it), once it has exited. */
  readonly exited: Promise<number | null>;
  /** The names of the variables the stand-in kit's child had. */
  readonly kitChildEnvironment: () => string[];
  /** The temp dirs of the gate that exist now. */
  readonly tempDirs: () => string[];
  stop(): Promise<void>;
}

const script = (path: string, text: string): void => {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
};

/** A promise and what settles it, as `Promise.withResolvers` gives (past this project's `lib`). */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });

  return { promise, resolve };
}

async function startWaiting(): Promise<Waiting> {
  const root = mkdtempSync(join(tmpdir(), "sauce-release-gate-stop-"));
  const [bin, stand, home, temp] = ["bin", "stand-in", "home", "tmp"].map((name) =>
    join(root, name),
  );
  for (const dir of [bin, stand, home, temp, join(stand, "bin"), join(stand, "sdk/runtime")]) {
    mkdirSync(dir, { recursive: true });
  }

  // The stand-in package: what `npm install` of the real one leaves, as far as the gate reads it.
  const seen = join(root, "kit-child-environment.json");
  writeFileSync(
    join(stand, "package.json"),
    JSON.stringify({
      name: "@eco-incorp/sauce",
      version: "9.9.9",
      bin: { sauce: "bin/sauce.mjs" },
      exports: {
        "./testing": { default: "./testing.mjs" },
        "./deployments": { default: "./deployments.mjs" },
        "./evm/engine": { default: "./engine.mjs" },
      },
    }),
  );
  writeFileSync(
    join(stand, "sdk/runtime/package.json"),
    JSON.stringify({ dependencies: { litesvm: "0.0.0" } }),
  );
  writeFileSync(join(stand, "bin/sauce.mjs"), "");
  writeFileSync(join(stand, "deployments.mjs"), "export {};\n");
  writeFileSync(join(stand, "engine.mjs"), "export {};\n");
  writeFileSync(
    join(stand, "testing.mjs"),
    [
      'import { spawnSync } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      "// What the real kit does to start anvil and its recorder: a child with no `env` of its own.",
      "const child = spawnSync(process.execPath, [",
      '  "-e",',
      '  "process.stdout.write(JSON.stringify(Object.keys(process.env)))",',
      '], { encoding: "utf8" });',
      `writeFileSync(${JSON.stringify(seen)}, child.stdout);`,
      'export const fork = async () => { throw new Error("the stand-in kit forks nothing"); };',
      "",
    ].join("\n"),
  );

  // The stand-in npm: it asks for the cache, and installs the stand-in package and LiteSVM.
  script(
    join(bin, "npm"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  config) echo "$TMPDIR/npm-cache" ;;',
      "  install)",
      "    for last; do :; done",
      '    case "$last" in',
      '      litesvm@*) mkdir -p node_modules/litesvm && echo \'{"name":"litesvm","version":"0.0.0"}\' > node_modules/litesvm/package.json ;;',
      `      *) mkdir -p node_modules/@eco-incorp && cp -R ${JSON.stringify(stand)} node_modules/@eco-incorp/sauce ;;`,
      "    esac ;;",
      "esac",
      "",
    ].join("\n"),
  );
  script(join(bin, "anvil"), '#!/bin/sh\necho "anvil Version: stand-in"\n');
  const tarball = join(root, "stand-in.tgz");
  writeFileSync(tarball, "not a tarball: the stand-in npm does not read it");

  // The one endpoint: a chain that never answers.
  const asked = deferred<void>();
  const server: Server = createServer(() => asked.resolve());
  const listening = deferred<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const { port } = server.address() as AddressInfo;
  const config = join(root, "rpc.config.json");
  writeFileSync(config, JSON.stringify({ "1": `http://127.0.0.1:${port}/KEYSEGMENT-0123456789` }));

  const child = spawn(process.execPath, [SCRIPT, "--package", tarball, "--rpc-config", config], {
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: home, TMPDIR: temp, ...OPERATOR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  for (const stream of [child.stdout!, child.stderr!])
    stream.on("data", (chunk) => (said += chunk));
  const gone = deferred<number | null>();
  child.once("exit", (code) => gone.resolve(code));
  const exited = gone.promise;

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    server.closeAllConnections();
    const closed = deferred<void>();
    server.close(() => closed.resolve());
    await closed.promise;
    rmSync(root, { recursive: true, force: true });
  };
  // Waiting on the chain, or gone before it got there: which the gate did decides the test, never a
  // guessed time (the test's own timeout bounds it).
  try {
    await Promise.race([
      asked.promise,
      exited.then(() => {
        throw new Error(`the gate exited before it waited on a chain:\n${said}`);
      }),
    ]);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    child,
    exited,
    kitChildEnvironment: () => JSON.parse(readFileSync(seen, "utf8")) as string[],
    tempDirs: () =>
      existsSync(temp)
        ? readdirSync(temp).filter((name) => name.startsWith("sauce-release-gate-"))
        : [],
    stop,
  };
}

describe("the release gate, waiting on a chain", () => {
  it("starts the installed kit's children with what a chain needs of the operator's environment, and none of the rest", async () => {
    const gate = await startWaiting();
    try {
      const names = gate.kitChildEnvironment();
      expect(names).toEqual(expect.arrayContaining(["PATH", "HOME", "TMPDIR"]));
      // Not one variable the operator has beyond what a chain needs: no canary, token or key.
      const given = Object.keys(OPERATOR);
      expect(names.filter((name) => given.includes(name))).toEqual([]);
    } finally {
      await gate.stop();
    }
  }, 120_000);
});

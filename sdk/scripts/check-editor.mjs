// What an editor shows for SauceScript, asked of the editor's own language server — tsserver, from
// the project's TypeScript — the way an editor asks it.
//
// `checkEditor`, in a project `sauce init` wrote:
//
//   - a program in `programs/` belongs to `programs/tsconfig.json`, whose declarations and plugin
//     come from the installed package;
//   - the programs given (an agent's, copied unchanged) show no error at all;
//   - every program of the skills the init installed, where it was installed, belongs to the
//     tsconfig.json the install wrote beside the skills, and shows no error either;
//   - a real mistake still shows;
//   - the project's other TypeScript, a Node file outside `programs/`, is untouched: SauceScript's
//     `crypto` and `require` never reach it.
//
// `checkRepositoryEditor`, in this repository's own checkout: every program it tracks belongs to the
// root tsconfig.json, with the declarations of the build and the plugin of the SDK workspace, and
// shows no error; a real mistake still shows; the TypeScript beside the programs keeps its project.
//
// `check-packed-package.mjs` runs the first against the installed tarball, `pnpm docs:check` the
// second; `node check-editor.mjs <project> <tsserver.js> <program.sauce.ts>…` runs the first on its
// own.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** A tsserver session: `request(command, args)` resolves with the response's body. */
function tsserver(path, cwd) {
  const child = spawn(process.execPath, [path, "--disableAutomaticTypingAcquisition"], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  let seq = 0;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const header = /^Content-Length: (\d+)\r\n\r\n/.exec(buffer);
      if (header === null) break;
      const start = header[0].length;
      const length = Number(header[1]);
      // The length counts bytes; the messages here are ASCII paths and diagnostics.
      if (Buffer.byteLength(buffer.slice(start)) < length) break;
      const body = Buffer.from(buffer.slice(start)).subarray(0, length).toString();
      buffer = Buffer.from(buffer.slice(start)).subarray(length).toString();
      const message = JSON.parse(body);
      if (message.type === "response" && pending.has(message.request_seq)) {
        const { resolve, reject } = pending.get(message.request_seq);
        pending.delete(message.request_seq);
        if (message.success) resolve(message.body);
        else reject(new Error(`tsserver ${message.command}: ${message.message}`));
      }
    }
  });

  return {
    request(command, args) {
      seq += 1;
      child.stdin.write(`${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`);

      return new Promise((resolve, reject) => pending.set(seq, { resolve, reject }));
    },
    notify(command, args) {
      seq += 1;
      child.stdin.write(`${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`);
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

/** Every error tsserver shows for `file`. */
async function diagnostics(server, file) {
  const [syntactic, semantic] = await Promise.all([
    server.request("syntacticDiagnosticsSync", { file }),
    server.request("semanticDiagnosticsSync", { file }),
  ]);

  return [...syntactic, ...semantic].map(
    (d) => `${basename(file)}:${d.start?.line ?? 0} TS${d.code} ${d.text}`,
  );
}

/** Every `*.sauce.ts` under `dir`, where it is. */
const programsUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sauce.ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

/** Asserts that each of `files` is in the project of `config` and shows no error. */
async function assertTyped(server, files, config, root) {
  for (const file of files) {
    const info = await server.request("projectInfo", { file, needFileNameList: false });
    assert.equal(
      info.configFileName,
      config,
      `${relative(root, file)} belongs to ${relative(root, config)}`,
    );
    assert.deepEqual(await diagnostics(server, file), [], `${relative(root, file)} shows no error`);
  }
}

/** A real mistake: one misspelled builtin, which shows. */
const MISTAKE = "function main() {\n  const me = ctx.slef();\n}\n";
const assertMistakeShows = (shown) =>
  assert.ok(
    shown.length === 1 && /TS(2339|2551) .*slef/.test(shown[0]),
    `a misspelled builtin still shows:\n${shown.join("\n")}`,
  );

export async function checkEditor({ project, tsserverPath, programs }) {
  const dir = join(project, "programs");
  mkdirSync(dir, { recursive: true });
  const files = programs.map((program) => {
    const at = join(dir, basename(program));
    copyFileSync(program, at);

    return at;
  });
  const mistake = join(dir, "mistake.sauce.ts");
  writeFileSync(mistake, MISTAKE);
  // The project's own TypeScript, outside programs/: Node's `crypto` and `process`.
  const tool = join(project, "tool.mts");
  writeFileSync(tool, "const id: string = crypto.randomUUID();\nconsole.log(id, process.argv);\n");

  const server = tsserver(tsserverPath, project);
  try {
    for (const file of [...files, mistake, tool]) server.notify("open", { file });
    for (const file of [...files, mistake]) {
      const info = await server.request("projectInfo", { file, needFileNameList: false });
      assert.equal(
        info.configFileName,
        join(dir, "tsconfig.json"),
        `${basename(file)} belongs to programs/tsconfig.json`,
      );
    }
    for (const file of files) {
      assert.deepEqual(await diagnostics(server, file), [], `${basename(file)} shows no error`);
    }
    assertMistakeShows(await diagnostics(server, mistake));
    // The skills where the init installed them, typed by the tsconfig.json written beside them.
    for (const skills of [".claude/skills", ".agents/skills"].map((dir) => join(project, dir))) {
      if (!existsSync(skills)) continue;
      const installed = programsUnder(skills);
      assert.ok(installed.length > 0, `${relative(project, skills)} holds the skills' programs`);
      for (const file of installed) server.notify("open", { file });
      await assertTyped(server, installed, join(skills, "tsconfig.json"), project);
    }
    const node = await diagnostics(server, tool);
    assert.deepEqual(node, [], "a Node file outside programs/ keeps Node's crypto and process");
  } finally {
    server.close();
  }

  return files.length;
}

/**
 * This repository's checkout as an editor opens it: every `*.sauce.ts` git tracks, in the root
 * tsconfig.json's project, with no error. A program reopened as a bigint index beside a number
 * still shows none — the plugin loaded — and reopened as a misspelled builtin shows it. A
 * skill's runner, a docs example's TypeScript and the SDK's own source each keep their project.
 * Returns how many programs it checked.
 */
export async function checkRepositoryEditor({ root, tsserverPath }) {
  const tracked = (pattern) =>
    execFileSync("git", ["ls-files", "-z", "--", pattern], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .map((path) => join(root, path));
  const config = join(root, "tsconfig.json");
  const programs = tracked("*.sauce.ts");
  assert.ok(programs.length > 0, "the repository tracks SauceScript programs");
  const runner = tracked("skills/*/examples/*.mts")[0];
  const example = tracked("docs/examples/*.ts").find((path) => !path.endsWith(".sauce.ts"));
  const source = join(root, "sdk/src/index.ts");

  const server = tsserver(tsserverPath, root);
  try {
    for (const file of [...programs, runner, example, source]) server.notify("open", { file });
    await assertTyped(server, programs, config, root);
    for (const file of [runner, example]) {
      const info = await server.request("projectInfo", { file, needFileNameList: false });
      assert.notEqual(info.configFileName, config, `${relative(root, file)} keeps its project`);
    }
    const sdk = await server.request("projectInfo", { file: source, needFileNameList: false });
    assert.equal(sdk.configFileName, join(root, "sdk/tsconfig.json"), "the SDK keeps its project");

    const [probe] = programs;
    const reopen = (fileContent) => {
      server.notify("close", { file: probe });
      server.notify("open", { file: probe, fileContent });
    };
    reopen("function main(xs: Uint256[], i: Uint256) {\n  require(xs[i] == 1);\n}\n");
    assert.deepEqual(
      await diagnostics(server, probe),
      [],
      "the plugin is loaded: a bigint index beside a number shows no error",
    );
    reopen(MISTAKE);
    assertMistakeShows(await diagnostics(server, probe));
  } finally {
    server.close();
  }

  return programs.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [project, tsserverPath, ...programs] = process.argv.slice(2);
  const checked = await checkEditor({ project, tsserverPath, programs });
  console.log(`check-editor: ${checked} programs show no error in ${project}/programs`);
}

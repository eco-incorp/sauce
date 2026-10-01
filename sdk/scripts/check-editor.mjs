// What an editor shows for SauceScript in a project `sauce init` wrote, asked of the editor's own
// language server — tsserver, from the project's TypeScript — the way an editor asks it:
//
//   - a program in `programs/` belongs to `programs/tsconfig.json`, whose declarations and plugin
//     come from the installed package;
//   - the programs given (an agent's, copied unchanged) show no error at all;
//   - a real mistake still shows;
//   - the project's other TypeScript, a Node file outside `programs/`, is untouched: SauceScript's
//     `crypto` and `require` never reach it.
//
// Run by `check-packed-package.mjs` against the installed tarball; `node check-editor.mjs
// <project> <tsserver.js> <program.sauce.ts>…` runs it on its own.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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

export async function checkEditor({ project, tsserverPath, programs }) {
  const dir = join(project, "programs");
  mkdirSync(dir, { recursive: true });
  const files = programs.map((program) => {
    const at = join(dir, basename(program));
    copyFileSync(program, at);

    return at;
  });
  const mistake = join(dir, "mistake.sauce.ts");
  writeFileSync(mistake, "function main() {\n  const me = ctx.slef();\n}\n");
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
    const shown = await diagnostics(server, mistake);
    assert.ok(
      shown.length === 1 && /TS(2339|2551) .*slef/.test(shown[0]),
      `a misspelled builtin still shows:\n${shown.join("\n")}`,
    );
    const node = await diagnostics(server, tool);
    assert.deepEqual(node, [], "a Node file outside programs/ keeps Node's crypto and process");
  } finally {
    server.close();
  }

  return files.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [project, tsserverPath, ...programs] = process.argv.slice(2);
  const checked = await checkEditor({ project, tsserverPath, programs });
  console.log(`check-editor: ${checked} programs show no error in ${project}/programs`);
}

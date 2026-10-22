// The size of one program on two SDK trees, each with its own linked compiler:
//   node one.mjs <tree-a> <tree-b> <chain> '<source>'
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [a, b, chain, source] = process.argv.slice(2);
for (const tree of [a, b]) {
  const { compileSauceProgram } = await import(
    pathToFileURL(join(tree, "sdk/dist/routes/index.js")).href
  );
  try {
    console.log(tree.split("/").pop(), compileSauceProgram(chain, source).bytecode.length);
  } catch (e) {
    console.log(
      tree.split("/").pop(),
      "ERR",
      String(e.message)
        .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
        .split("\n")
        .filter((l) => /╰─▶|error/.test(l))
        .slice(-1)[0],
    );
  }
}

#!/usr/bin/env node
// Keep this entry import-free so unsupported Node versions get an error before loading the CLI.
if (Number(process.versions.node.split(".")[0]) < 24) {
  process.stderr.write(
    `sauce requires Node.js 24 or newer; found ${process.versions.node}. ` +
      "Upgrade Node.js, then reinstall with npm install --global --engine-strict @eco-incorp/sauce@latest.\n",
  );
  process.exit(1);
}

await import("./start.js");

export {};

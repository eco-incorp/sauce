#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { resolve, join, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(__dirname, "..");

// Parse arguments
const args = process.argv.slice(2);
let targetName = ".";

if (args[0] === "init") {
  targetName = args[1] || ".";
} else if (args[0] && !args[0].startsWith("-")) {
  targetName = args[0];
}

const targetDir = resolve(process.cwd(), targetName);
const projectName = targetName === "." ? basename(process.cwd()) : basename(targetName);

// Read own package.json to get the compiler version
const ownPkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
const compilerVersion = ownPkg.version;

// Create target directory if needed
if (targetName !== ".") {
  if (existsSync(targetDir)) {
    console.error(`Error: directory "${targetName}" already exists.`);
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
}

// Copy template directories and files
const templateItems = [
  "scripts",
  "src",
  "sauce",
  "artifacts",
  "hardhat.config.cjs",
  "tsconfig.json",
  "README.md",
];

for (const item of templateItems) {
  const src = join(packageRoot, item);
  const dest = join(targetDir, item);
  if (!existsSync(src)) continue;
  cpSync(src, dest, { recursive: true });
}

// Make shell scripts executable
const shellScripts = ["scripts/start-local.sh", "scripts/start-fork.sh", "scripts/stop-local.sh"];
for (const script of shellScripts) {
  const scriptPath = join(targetDir, script);
  if (existsSync(scriptPath)) {
    chmodSync(scriptPath, 0o755);
  }
}

// Generate package.json
const pkg = {
  name: projectName,
  version: "0.0.1",
  private: true,
  type: "module",
  scripts: {
    sauce: "npx tsx scripts/run.ts",
    "start:local": "./scripts/start-local.sh",
    "start:fork": "./scripts/start-fork.sh",
    stop: "./scripts/stop-local.sh",
  },
  dependencies: {
    "@eco-incorp/sauce-compiler": `^${compilerVersion}`,
    "@uniswap/v3-core": "^1.0.1",
    viem: "^2.45.1",
  },
  devDependencies: {
    "@types/node": "^22.0.0",
    hardhat: "^2.22.0",
    tsx: "^4.7.0",
    typescript: "^5.7.0",
  },
};

writeFileSync(join(targetDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// Generate .npmrc
writeFileSync(join(targetDir, ".npmrc"), "@eco:registry=https://npm.pkg.github.com\n");

// Generate .gitignore
const gitignore = `# Dependencies
node_modules/

# Build outputs
dist/
out/
cache/
artifacts/

# Local deployment state
.deployment.json

# Logs
*.log
npm-debug.log*

# IDE
.idea/
.vscode/
*.swp
*.swo
.DS_Store

# TypeScript
*.tsbuildinfo
`;

writeFileSync(join(targetDir, ".gitignore"), gitignore);

// Print next steps
console.log(`
Sauce project created in ${targetName === "." ? "current directory" : targetName}!

Next steps:

  ${targetName !== "." ? `cd ${targetName}\n  ` : ""}npm install
  npm run start:local
  npm run sauce sauce/js/example.js
`);

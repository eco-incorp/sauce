// Builds the Rust SauceScript compiler to WASM FROM the `sauce-next` git dep
// (github:eco-incorp/sauce#main) into a gitignored `sdk/.sauce-wasm/`, the same
// way `sync-engine-artifacts.mjs` derives the engine artifacts from the pinned
// `sauce` (release/beta) dep. Nothing is committed: the `@sauce/token` suites
// (sdk/test/std/token) load the freshly-built module from `.sauce-wasm/`.
//
// `sauce#main` ships source only (no prebuilt wasm, no lifecycle build), so this
// runs `wasm-pack build crates/sauce-wasm --target nodejs` (the crate's own
// Makefile `pkg:` target). Needs Rust (the repo pins 1.97.1 via rust-toolchain)
// + the wasm32-unknown-unknown target + wasm-pack. CI installs them next to
// Foundry/hnc; a contributor without the toolchain gets a clean SKIP and the
// token suites self-skip (see harness.ts `wasmAvailable`), so `pnpm test` stays
// green offline. Refresh on a `sauce-next` repin with SAUCE_WASM_REBUILD=1.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SDK_DIR, '..');
const OUT = resolve(SDK_DIR, '.sauce-wasm');

if (existsSync(resolve(OUT, 'sauce_wasm.js')) && !process.env.SAUCE_WASM_REBUILD) {
  console.log('[build-wasm] .sauce-wasm already built (set SAUCE_WASM_REBUILD=1 to rebuild)');
  process.exit(0);
}

// Locate the sauce-next checkout — a devDep of sdk; pnpm exposes a package.json-less
// git dep under its dep-key name, same shape sync-engine-artifacts resolves `sauce`.
const CANDIDATES = [
  resolve(SDK_DIR, 'node_modules', 'sauce-next'),
  resolve(REPO_ROOT, 'node_modules', 'sauce-next'),
];
const sauceNext = CANDIDATES.find((p) => existsSync(resolve(p, 'compiler', 'crates', 'sauce-wasm', 'Cargo.toml')));
if (!sauceNext) {
  console.error('[build-wasm] `sauce-next` checkout not found. Run `pnpm install` first.');
  process.exit(1);
}

// The Rust WASM compiler is REQUIRED — it is the SDK's SauceScript compiler going forward — so a
// missing toolchain is a HARD ERROR, not a skip (same posture as Foundry for the compiler suites).
if (spawnSync('wasm-pack', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error(
    '[build-wasm] wasm-pack not found. The Rust SauceScript compiler is required. Install:\n' +
      '  https://rustwasm.github.io/wasm-pack/installer/  then `rustup target add wasm32-unknown-unknown`',
  );
  process.exit(1);
}

const compilerDir = resolve(sauceNext, 'compiler');

// Force the rustup toolchain: a Homebrew `rustc` has no wasm32 target in its sysroot, but the
// crate's rust-toolchain.toml pins a rustup toolchain that does. Prepend the rustup cargo bin so
// wasm-pack's cargo/rustc resolve to rustup, and ensure the wasm32 target is installed for it.
const env = { ...process.env };
const cargoBin = process.env.CARGO_HOME ? resolve(process.env.CARGO_HOME, 'bin') : resolve(homedir(), '.cargo', 'bin');
if (existsSync(resolve(cargoBin, 'rustup'))) {
  env.PATH = `${cargoBin}:${env.PATH ?? ''}`;
  spawnSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { cwd: compilerDir, env, stdio: 'inherit' });
}

console.log(`[build-wasm] wasm-pack build crates/sauce-wasm --target nodejs -> ${OUT}`);
const r = spawnSync('wasm-pack', ['build', 'crates/sauce-wasm', '--target', 'nodejs', '--out-dir', OUT], {
  cwd: compilerDir,
  env,
  stdio: 'inherit',
});
if (r.status !== 0) {
  console.error('[build-wasm] wasm-pack build failed.');
  process.exit(r.status ?? 1);
}
console.log('[build-wasm] done.');

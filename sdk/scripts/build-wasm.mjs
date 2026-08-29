// Builds the Rust SauceScript compiler to WASM from the `sauce-next` dep — the sauce repo pinned by
// SHA in sdk/package.json — into a gitignored `sdk/.sauce-wasm/`, the same way
// `sync-engine-artifacts.mjs` derives the engine artifacts from the pinned `sauce` dep.
//
// `sauce-next` is a SOURCE checkout, not a package: the repo has no root package.json and ships no
// prebuilt wasm, so pnpm hands it over verbatim and the build happens here, via
// `wasm-pack build crates/sauce-wasm --target nodejs`. Needs Rust (the repo pins 1.97.1 via
// rust-toolchain.toml), the wasm32-unknown-unknown target, and wasm-pack — CI installs all three
// next to Foundry/hnc.
//
// The Rust compiler IS the SDK's compiler, so a missing toolchain is a HARD ERROR rather than a
// skip: a skip reads exactly like a pass, and the suites that consume `.sauce-wasm/` would go green
// having compiled nothing. Idempotent — re-runs exit early once the output exists, so it is safe as
// a pre-hook on test/build/typecheck. Force a rebuild after a repin with SAUCE_WASM_REBUILD=1.
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

// pnpm exposes a package.json-less git dep under its dep-key name — the same shape
// sync-engine-artifacts resolves `sauce` with, and the reason both candidates are probed.
const CANDIDATES = [
  resolve(SDK_DIR, 'node_modules', 'sauce-next'),
  resolve(REPO_ROOT, 'node_modules', 'sauce-next'),
];
const sauceNext = CANDIDATES.find((p) => existsSync(resolve(p, 'compiler', 'crates', 'sauce-wasm', 'Cargo.toml')));
if (!sauceNext) {
  console.error('[build-wasm] `sauce-next` checkout not found. Run `pnpm install` first.');
  process.exit(1);
}

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
const built = spawnSync('wasm-pack', ['build', 'crates/sauce-wasm', '--target', 'nodejs', '--out-dir', OUT], {
  cwd: compilerDir,
  env,
  stdio: 'inherit',
});
if (built.status !== 0) {
  console.error('[build-wasm] wasm-pack build failed.');
  process.exit(built.status ?? 1);
}
console.log('[build-wasm] done.');

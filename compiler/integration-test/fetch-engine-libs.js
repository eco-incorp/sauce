// Populates node_modules/sauce/engine/lib with the OpenZeppelin contracts
// required to compile engine/src. pnpm doesn't recurse git submodules, so the
// `sauce` dep arrives without lib/, and `forge create src/Sauce.sol:Sauce`
// would fail without this step. Pin matches the submodule SHA in eco-incorp/sauce.
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const COMPILER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_LIB = resolve(COMPILER_DIR, 'node_modules/sauce/engine/lib');

const submodules = [
  {
    name: 'openzeppelin-contracts',
    url: 'https://github.com/OpenZeppelin/openzeppelin-contracts.git',
    sha: '33abe27ddb835a49d4b0ecc4717eeff03535a4cd',
  },
];

if (!existsSync(resolve(COMPILER_DIR, 'node_modules/sauce/engine'))) {
  // The sauce dep isn't installed yet (e.g. dependency-only filtered install).
  process.exit(0);
}

for (const { name, url, sha } of submodules) {
  const target = resolve(ENGINE_LIB, name);
  if (existsSync(resolve(target, 'contracts'))) continue;
  console.log(`[fetch-engine-libs] cloning ${name}@${sha.slice(0, 7)}`);
  execSync(`git init -q "${target}"`, { stdio: 'inherit' });
  execSync(`git -C "${target}" remote add origin "${url}"`, { stdio: 'inherit' });
  execSync(`git -C "${target}" fetch -q --depth 1 origin ${sha}`, { stdio: 'inherit' });
  execSync(`git -C "${target}" checkout -q FETCH_HEAD`, { stdio: 'inherit' });
}

// Build src so out/Sauce.sol/Sauce.json (and friends) exist for downstream
// consumers (actions integration tests read this artifact at test time).
// `forge create` in the compiler's global-setup will reuse this build, and
// skipping test/script avoids pulling in forge-std / huff-neo submodules.
const engineDir = resolve(COMPILER_DIR, 'node_modules/sauce/engine');
if (!existsSync(resolve(engineDir, 'out/Sauce.sol/Sauce.json'))) {
  console.log('[fetch-engine-libs] forge build engine src');
  try {
    execSync('forge build --skip test --skip script', { cwd: engineDir, stdio: 'inherit' });
  } catch {
    console.warn(
      '[fetch-engine-libs] forge build failed (foundry not installed?); integration tests that read engine artifacts will fail until you run it manually',
    );
  }
}

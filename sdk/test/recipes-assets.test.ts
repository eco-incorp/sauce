/**
 * The two assertions in `verify.compile.test.ts`'s neighbourhood that need no compiler at all.
 *
 * They are about the SHIPPED ASSETS: the recipe the SDK hands partners must be the file on disk, and
 * the base dir must resolve the ABI that file imports. The second one is load-bearing —
 * `src/artifacts/` is generated and gitignored, and a dozen suites fail with nothing naming the cause
 * when it is absent. Whether those assets COMPILE to the pinned program is `verify.compile.test.ts`.
 */
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { SAUCE_BASE_DIRS, SETTLE_SOURCE_PATH, settleSource } from '../src/recipes/index.js';

describe('shipped recipe assets', () => {
  it('settleSource() returns the exact on-disk settle.sauce.ts', () => {
    const onDisk = readFileSync(resolve(process.cwd(), 'src/recipes/settle.sauce.ts'), 'utf-8');
    expect(settleSource()).toBe(onDisk);
  });

  it("SAUCE_BASE_DIRS resolves the program's ./artifacts/IERC20.json import", () => {
    // The one entry is the dist/src ROOT, not the programs dir — that is where `./artifacts/` lives.
    expect(SAUCE_BASE_DIRS).toHaveLength(1);
    expect(readFileSync(join(SAUCE_BASE_DIRS[0]!, 'artifacts', 'IERC20.json'), 'utf-8').length).toBeGreaterThan(0);
    expect(dirname(SETTLE_SOURCE_PATH)).not.toBe(SAUCE_BASE_DIRS[0]);
  });
});

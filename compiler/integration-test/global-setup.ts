import { execSync, spawn } from 'child_process';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

const ENGINE_DIR = resolve(process.cwd(), 'node_modules/sauce/engine');
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const STATE_FILE = resolve(process.cwd(), '.integration-test-state.json');

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const checkRpc = (): boolean => (execSync(`cast chain-id --rpc-url ${RPC}`, { stdio: 'ignore' }), true);

const waitForRpc = (deadline: number): Promise<void> =>
  Date.now() >= deadline
    ? Promise.reject(new Error('anvil startup timeout'))
    : Promise.resolve()
        .then(checkRpc)
        .catch(() => delay(100).then(() => waitForRpc(deadline)));

const deploy = (): string =>
  execSync(`forge create src/Sauce.sol:Sauce --rpc-url ${RPC} --private-key ${PK} --broadcast`, {
    cwd: ENGINE_DIR,
    encoding: 'utf8',
  });

const parseAddress = (output: string): string =>
  output.match(/Deployed to: (0x[0-9a-fA-F]+)/)?.[1] ??
  (() => {
    throw new Error(`deploy failed: ${output}`);
  })();

export default async () => {
  const anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore', detached: true });

  return waitForRpc(Date.now() + 10_000)
    .then(deploy)
    .then(parseAddress)
    .then((address) => writeFileSync(STATE_FILE, JSON.stringify({ pid: anvil.pid, address })));
};

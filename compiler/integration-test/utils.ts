import { compile, type CompileOptions } from '../src/index.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
// Anvil's default 10 accounts. Each Jest worker uses a distinct PK so concurrent
// test files don't race on the same EOA's nonce (forge create / cast send).
const PKS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
];
const PK = PKS[(parseInt(process.env.JEST_WORKER_ID || '1', 10) - 1) % PKS.length];
const STATE_FILE = resolve(process.cwd(), '.integration-test-state.json');

const toHex = (bytes: Uint8Array): string => '0x' + Buffer.from(bytes).toString('hex');

const getAddress = (): string => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

  return state.address;
};

export const cook = (source: string, options?: CompileOptions): string => {
  const address = getAddress();
  const { bytecode } = compile(source, options);
  const hexes = bytecode.map((code) => toHex(code));

  return execSync(`cast call ${address} "cook(bytes[])(bytes)" "[${hexes.join(',')}]" --rpc-url ${RPC}`, {
    encoding: 'utf8',
  }).trim();
};

export interface Log {
  topics: string[];
  data: string;
}

// Like cook, but sends a transaction to commit state changes and returns logs
export const cookSend = (source: string, options?: CompileOptions): void => {
  const address = getAddress();
  const { bytecode } = compile(source, options);
  const hexes = bytecode.map((code) => toHex(code));

  const txResult = execSync(
    `cast send ${address} "cook(bytes[])(bytes)" "[${hexes.join(',')}]" --rpc-url ${RPC} --private-key ${PK} --json`,
    { encoding: 'utf8' },
  ).trim();
  const { transactionHash } = JSON.parse(txResult);

  const receipt = execSync(`cast receipt ${transactionHash} --rpc-url ${RPC} --json`, { encoding: 'utf8' }).trim();
  const { logs } = JSON.parse(receipt);

  return logs.map((log: { topics: string[]; data: string }) => ({
    topics: log.topics,
    data: log.data,
  }));
};

export const deploy = (contract: string): string => {
  const engineDir = resolve(process.cwd(), 'node_modules/sauce/engine');
  const output = execSync(`forge create ${contract} --rpc-url ${RPC} --private-key ${PK} --broadcast`, {
    cwd: engineDir,
    encoding: 'utf8',
  });

  const match = output.match(/Deployed to: (0x[0-9a-fA-F]+)/);

  if (!match) throw new Error(`deploy failed: ${output}`);

  return match[1];
};

export const getSauceAddress = (): string => getAddress();

export const getNonce = (address: string): bigint =>
  BigInt(execSync(`cast nonce ${address} --rpc-url ${RPC}`, { encoding: 'utf8' }).trim());

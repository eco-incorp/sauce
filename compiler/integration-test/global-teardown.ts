import { resolve } from 'path';
import { readFile, unlink } from 'fs/promises';

const STATE_FILE = resolve(process.cwd(), '.integration-test-state.json');

const readState = (): Promise<{ pid?: number }> => readFile(STATE_FILE, 'utf8').then(JSON.parse);

const cleanup = (state: { pid?: number }): Promise<void> => (state.pid && process.kill(state.pid), unlink(STATE_FILE));

export default () =>
  readState()
    .then(cleanup)
    .catch(() => {});

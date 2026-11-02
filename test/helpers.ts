import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Examples live at the repo root. Tests run from dist-test/test. */
export const examplesDir = path.resolve(here, '../../examples');

/** Monday 2 Nov 2026. Every relative date in the suite uses this day. */
export const REFERENCE = '2026-11-02';

export function installNetworkGuard(): void {
  globalThis.fetch = async () => {
    throw new Error('network disabled in tests');
  };
}

export function lineOf(content: string, needle: string): number {
  const index = content.split(/\r?\n/).findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`Fixture is missing ${needle}`);
  return index + 1;
}

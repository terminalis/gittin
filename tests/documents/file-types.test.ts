import { expect, test } from 'vitest';
import { otherTs } from '../../src/documents/file-types';

test('a .ts file that is a Qt translation or a video is named as such; TypeScript and other files are not', () => {
  expect(otherTs('app_de.ts',
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="de">')).toBe('a Qt translation file');
  expect(otherTs('recording.ts', null)).toBe('a video file');
  expect(otherTs('main.ts', 'export const tag = "<TS>";')).toBeNull();
  expect(otherTs('notes.md', null)).toBeNull();
});

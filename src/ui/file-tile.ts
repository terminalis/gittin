import { fileDescriptor, type FileType } from '../documents/file-types';
import { el } from './dom';

/** A file's type as a short typewriter tag ("MD", "YAML") beside its name on Home; unknown types show their extension. */
export function fileTile(type: FileType, name: string): HTMLElement {
  const tag = fileDescriptor(type)?.tag ?? /\.([a-z0-9]{1,4})$/i.exec(name)?.[1].toUpperCase() ?? 'TXT';
  return el('span', { className: 'file-tile', textContent: tag, ariaHidden: 'true' });
}

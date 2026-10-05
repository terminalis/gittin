import type { FileType } from '../documents/file-types';
import { commentSyntax } from './source-language';
import { safeURL } from './safe-url';
export type AttributionFormat = 'markdown' | 'comment' | 'spdx' | 'cff';
export interface Attribution {
  project: string; author: string; authorKind: 'person' | 'entity'; given: string; family: string;
  url: string; licence: string; copyright: string; modifications: string;
}
const markdown = (value: string) => value.replace(/[\\`*_{}[\]()<>#!|]/g, '\\$&');
const yaml = (value: string) => JSON.stringify(value);
/** A line for a supplied value, or none for an empty one. */
const given = (value: string, line: (value: string) => string) => (value.trim() ? [line(value.trim())] : []);
/** Format only supplied metadata; no licence selection or compliance inference. */
export function attributionText(data: Attribution, format: AttributionFormat, type: FileType): string {
  const values = Object.values(data);
  if (values.some(v => /[\u0000-\u001f]/.test(v))) throw Error('Use single-line metadata.');
  const project = data.project.trim(), author = data.author.trim(), url = data.url.trim();
  if (!project) throw Error('Enter a project or work title.');
  if (url && (!safeURL(url) || !/^https?:\/\//i.test(url) || /[\s<>]/.test(url)))
    throw Error('Source URL must be an HTTP or HTTPS URL.');
  if (url) { try { new URL(url); } catch { throw Error('Enter a valid source URL.'); } }
  if (format === 'cff') {
    const person = data.authorKind === 'person';
    if (person ? !data.family.trim() : !author)
      throw Error('Supply an author family name or project/organisation name.');
    const authors = person
      ? ['  - family-names: ' + yaml(data.family.trim()),
        ...given(data.given, v => '    given-names: ' + yaml(v))]
      : ['  - name: ' + yaml(author)];
    return [
      'cff-version: 1.2.0', 'message: "Please cite this work using the metadata in this file."',
      'title: ' + yaml(project), 'authors:', ...authors, ...given(url, v => 'url: ' + yaml(v)),
      ...given(data.licence, v => '# Supplied licence information: ' + yaml(v)),
      ...given(data.modifications, v => '# Modifications: ' + yaml(v)),
    ].join('\n') + '\n';
  }
  if (format === 'markdown')
    return [
      'Credit: ' + markdown(project) + (author ? ' by ' + markdown(author) : ''),
      ...given(url, v => 'Source: <' + v.replace(/[<>]/g, c => encodeURIComponent(c)) + '>'),
      ...given(data.licence, v => 'Licence: ' + markdown(v)),
      ...given(data.modifications, v => 'Modifications: ' + markdown(v)),
    ].join('\n') + '\n';
  const syntax = commentSyntax(type), html = type === 'markdown' || type === 'html';
  if (!syntax.block && !syntax.line) throw Error('This file type does not support attribution comments.');
  if (values.some(v => (syntax.block?.[1] && v.includes(syntax.block[1])) || html && v.includes('--')))
    throw Error('Remove comment delimiters from supplied metadata.');
  if (format === 'spdx' && (!data.copyright.trim() || !data.licence.trim()))
    throw Error('Supply copyright text and an SPDX licence expression.');
  const lines = format === 'spdx'
    ? ['SPDX-FileCopyrightText: ' + data.copyright.trim(), 'SPDX-License-Identifier: ' + data.licence.trim()]
    : ['Credit: ' + project + (author ? ' by ' + author : ''), ...given(url, v => 'Source: ' + v),
      ...given(data.licence, v => 'Licence: ' + v), ...given(data.modifications, v => 'Modifications: ' + v)];
  return syntax.block
    ? syntax.block[0] + '\n' + lines.join('\n') + '\n' + syntax.block[1] + '\n'
    : lines.map(l => syntax.line + ' ' + l).join('\n') + '\n';
}

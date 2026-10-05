/** Git's blob object id: the version GitHub reports for a file with these bytes. */
export async function blobVersion(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

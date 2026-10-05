import type { DirectoryHandle, FileHandle } from '../../src/sources/handle';

type FileNode = { kind: 'file'; bytes: Uint8Array };
type DirectoryNode = { kind: 'directory'; children: Map<string, Node> };
type Node = FileNode | DirectoryNode;
const notFound = () => new DOMException('Not found', 'NotFoundError');

export function fakeDirectory(name: string, files: Record<string, string>) {
  const root: DirectoryNode = { kind: 'directory', children: new Map() };
  const put = (path: string, text: string) => {
    const parts = path.split('/'), file = parts.pop()!;
    let dir = root;
    for (const part of parts) {
      let next = dir.children.get(part);
      if (!next) dir.children.set(part, (next = { kind: 'directory', children: new Map() }));
      dir = next as DirectoryNode;
    }
    dir.children.set(file, { kind: 'file', bytes: new TextEncoder().encode(text) });
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  // Lets a file handle's move() find the directory it was handed.
  const directories = new WeakMap<DirectoryHandle, DirectoryNode>();
  const fileHandle = (name: string, node: FileNode, parent: DirectoryNode): FileHandle => ({
    kind: 'file', name,
    getFile: async () => new File([node.bytes as BlobPart], name),
    createWritable: async () => {
      let next = new Uint8Array();
      return {
        write: async (blob: Blob) => { next = new Uint8Array(await blob.arrayBuffer()); },
        close: async () => { node.bytes = next; },
        abort: async () => {},
      };
    },
    move: async (target, next) => {
      parent.children.delete(name);
      directories.get(target)!.children.set(next, node);
    },
  });
  const directoryHandle = (name: string, node: DirectoryNode): DirectoryHandle => {
    const handle: DirectoryHandle = {
      kind: 'directory', name,
      async *values() {
        for (const [child, value] of node.children)
          yield value.kind === 'file' ? fileHandle(child, value, node) : directoryHandle(child, value);
      },
      getDirectoryHandle: async (child, options) => {
        let value = node.children.get(child);
        if (!value && options?.create) node.children.set(child, (value = { kind: 'directory', children: new Map() }));
        if (value?.kind !== 'directory') throw notFound();
        return directoryHandle(child, value);
      },
      getFileHandle: async (child, options) => {
        let value = node.children.get(child);
        if (!value && options?.create) node.children.set(child, (value = { kind: 'file', bytes: new Uint8Array() }));
        if (value?.kind !== 'file') throw notFound();
        return fileHandle(child, value, node);
      },
      removeEntry: async (child, options) => {
        const value = node.children.get(child);
        if (!value) throw notFound();
        if (value.kind === 'directory' && value.children.size && !options?.recursive)
          throw new DOMException('Not empty', 'InvalidModificationError');
        node.children.delete(child);
      },
      resolve: async () => null,
    };
    directories.set(handle, node);
    return handle;
  };
  const find = (path: string) => {
    let node: Node | undefined = root;
    for (const part of path.split('/')) node = node?.kind === 'directory' ? node.children.get(part) : undefined;
    return node;
  };
  const text = (path: string) => {
    const node = find(path);
    return node?.kind === 'file' ? new TextDecoder().decode(node.bytes) : undefined;
  };
  const kind = (path: string) => find(path)?.kind;
  return { handle: directoryHandle(name, root), put, text, kind };
}

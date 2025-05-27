import { create } from 'zustand';

export type FileNode = { id: string; name: string; path: string; children?: FileNode[] };

interface FSState {
  tree: FileNode[];
  current?: FileNode;
  fileContents: Record<string, string>;
  setCurrent: (id: string) => void;
  load: (t: FileNode[]) => void;
  loadContents: () => Promise<void>;
}

export const useFS = create<FSState>((set, get) => ({
  tree: [],
  current: undefined,
  fileContents: {},
  setCurrent: (id) => set((state) => ({ current: find(state.tree, id) })),
  load: (tree) => set({ tree }),
  loadContents: async () => {
    const paths = getAllFilePaths(get().tree, false); // 파일만 가져오기
    for (const path of paths) {
      try {
        const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
        if (response.ok) {
          const content = await response.text();
          set((state) => ({
            fileContents: { ...state.fileContents, [path]: content },
          }));
        } else {
          console.error(`Failed to fetch content for ${path}: ${response.status}`);
        }
      } catch (err) {
        console.error(`Error loading content for ${path}:`, err);
      }
    }
  },
}));

function find(nodes: FileNode[], id: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const r = find(n.children, id);
      if (r) return r;
    }
  }
}

export function getAllFilePaths(tree: FileNode[], includeFolders = false): string[] {
  const paths: string[] = [];
  const traverse = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (!node.children || includeFolders) {
        const cleanPath = node.path.replace(/^poc[\\/]/, '');
        paths.push(cleanPath);
      }
      if (node.children) traverse(node.children);
    }
  };
  traverse(tree);
  return paths;
}
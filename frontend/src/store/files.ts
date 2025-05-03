import { create } from 'zustand'

export type FileNode = { id: string; name: string; path: string; children?: FileNode[] }

interface FSState {
  tree: FileNode[]
  current?: FileNode
  setCurrent: (id: string) => void
  load: (t: FileNode[]) => void
}

export const useFS = create<FSState>(set => ({
  tree: [],
  current: undefined,
  setCurrent: id => set(s => ({ current: find(s.tree, id) })),
  load: tree => set({ tree })
}))

function find(nodes: FileNode[], id: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const r = find(n.children, id)
      if (r) return r
    }
  }
}

'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface TabMeta {
  id: string;    // nanoid()
  path: string;  // '/src/App.tsx'
  name: string;  // 'App.tsx'
}

interface State {
  tabs: TabMeta[];
  activeId?: string;
  open:  (file: TabMeta) => void;
  close: (id: string)    => void;
  setActive: (id: string) => void;
}

export const useEditor = create<State>()(
  immer((set) => ({
    tabs: [],
    activeId: undefined,

    open: (file) =>
      set((s) => {
        if (!s.tabs.find((t) => t.path === file.path)) s.tabs.push(file);
        s.activeId = s.tabs.find((t) => t.path === file.path)?.id ?? file.id;
      }),

    close: (id) =>
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.id !== id);
        if (s.activeId === id) s.activeId = s.tabs.at(-1)?.id;
      }),

    setActive: (id) => set({ activeId: id }),
  }))
);

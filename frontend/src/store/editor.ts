"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useFS } from "@/store/files";

const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER;

export interface TabMeta {
  id: string;
  path: string;
  name: string;
}

interface State {
  tabs: TabMeta[];
  activeId?: string;
  activePath?: string;
  searchHighlights?: { line: number; query: string };
  highlight?: { from: number; to: number }; // 추가: highlight 범위
  open: (file: TabMeta & { line?: number; highlight?: { from: number; to: number } }) => void;
  close: (id: string) => void;
  setActive: (id: string, highlight?: { from: number; to: number }) => void; // highlight 인자 추가
  setSearchHighlights: (line: number, query: string) => void;
}

export const useEditor = create<State>()(
  immer((set) => ({
    tabs: [],
    activeId: undefined,
    activePath: undefined,
    searchHighlights: undefined,
    highlight: undefined,
    open: (file) =>
      set((s) => {
        if (!s.tabs.find((t) => t.path === file.path)) s.tabs.push(file);
        s.activeId = s.tabs.find((t) => t.path === file.path)?.id ?? file.id;
        s.activePath = file.path;
        s.searchHighlights = undefined;
        if (file.highlight) {
          s.highlight = file.highlight;
        } else {
          s.highlight = undefined;
        }
      }),
    close: (id) =>
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.id !== id);
        if (s.activeId === id) {
          const lastTab = s.tabs.at(-1);
          s.activeId = lastTab?.id;
          s.activePath = lastTab?.path;
        }
        s.searchHighlights = undefined;
        s.highlight = undefined;
      }),
    setActive: (id, highlight) =>
      set((s) => {
        s.activeId = id;
        s.activePath = s.tabs.find((t) => t.id === id)?.path;
        if (s.activePath) {
          const node = findByPath(useFS.getState().tree, s.activePath);
          if (node) useFS.getState().setCurrent(node.id);
        }
        s.searchHighlights = undefined;
        if (highlight) {
          s.highlight = highlight;
        } else {
          s.highlight = undefined;
        }
      }),
    setSearchHighlights: (line, query) =>
      set((s) => {
        s.searchHighlights = { line, query };
      }),
  }))
);

function findByPath(nodes: FileNode[], path: string): FileNode | undefined {
  const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);

  for (const n of nodes) {
    if (n.path?.replace(regex, "") === path) return n;

    if (n.children) {
      const r = findByPath(n.children, path);
      if (r) return r;
    }
  }
}

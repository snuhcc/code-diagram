// frontend/src/store/editor.ts
'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useFS } from '@/store/files'; // 추가: 파일 탐색기 상태 접근

export interface TabMeta {
  id: string;    // nanoid()
  path: string;  // '/src/App.tsx'
  name: string;  // 'App.tsx'
}

interface State {
  tabs: TabMeta[];
  activeId?: string;
  activePath?: string; // 추가: 활성화된 파일 경로 추적
  open: (file: TabMeta) => void;
  close: (id: string) => void;
  setActive: (id: string) => void;
}

export const useEditor = create<State>()(
  immer((set) => ({
    tabs: [],
    activeId: undefined,
    activePath: undefined, // 초기값 설정
    open: (file) =>
      set((s) => {
        if (!s.tabs.find((t) => t.path === file.path)) s.tabs.push(file);
        s.activeId = s.tabs.find((t) => t.path === file.path)?.id ?? file.id;
        s.activePath = file.path; // 파일 열 때 경로 설정
      }),
    close: (id) =>
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.id !== id);
        if (s.activeId === id) {
          const lastTab = s.tabs.at(-1);
          s.activeId = lastTab?.id;
          s.activePath = lastTab?.path; // 탭 닫을 때 경로 업데이트
        }
      }),
    setActive: (id) =>
      set((s) => {
        s.activeId = id;
        s.activePath = s.tabs.find((t) => t.id === id)?.path; // 탭 변경 시 경로 업데이트
        if (s.activePath) {
          const node = findByPath(useFS.getState().tree, s.activePath);
          if (node) useFS.getState().setCurrent(node.id); // 파일 탐색기 동기화
        }
      }),
  }))
);

// 파일 경로로 FileNode를 찾는 유틸리티 함수
function findByPath(nodes: FileNode[], path: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path?.replace(/^poc[\\/]/, '') === path) return n;
    if (n.children) {
      const r = findByPath(n.children, path);
      if (r) return r;
    }
  }
}
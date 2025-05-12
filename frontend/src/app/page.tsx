// src/app/page.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useFS } from '@/store/files';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,      // ← 이름 변경
} from 'react-resizable-panels';

import IconBar      from '@/components/IconBar';
import FileExplorer from '@/components/FileExplorer';

const EditorTabs    = dynamic(() => import('@/components/EditorTabs'),    { ssr: false });
const DiagramViewer = dynamic(() => import('@/components/DiagramViewer'), { ssr: false });
const ChatUI        = dynamic(() => import('@/components/ChatUI'),        { ssr: false });

/* ───── 공용 핸들 ───── */
const HHandle = () => (
  <PanelResizeHandle className="w-[4px] bg-[--color-border] hover:bg-[--color-accent] cursor-col-resize" />
);
const VHandle = () => (
  <PanelResizeHandle className="h-[4px] bg-[--color-border] hover:bg-[--color-accent] cursor-row-resize" />
);

export default function Home() {
  const { current } = useFS();
  const [showExp,  setExp]  = useState(true);
  const [showDia,  setDia]  = useState(true);
  const [showChat, setChat] = useState(true);

  return (
    <div className="flex h-full">
      {/* 왼쪽 아이콘바 */}
      <IconBar
        states={{ exp: showExp, dia: showDia, chat: showChat }}
        toggle={{
          exp:  () => setExp(!showExp),
          dia:  () => setDia(!showDia),
          chat: () => setChat(!showChat),
        }}
      />

      {/* ───────── 수평 패널 그룹 ───────── */}
      <PanelGroup direction="horizontal" className="flex-1">

        {/* ① 파일 탐색기 */}
        {showExp && (
          <>
            <Panel defaultSize={20} minSize={14}>
              <FileExplorer />
            </Panel>
            <HHandle />
          </>
        )}

        {/* ② 코드 에디터 */}
        <>
          <Panel defaultSize={50} minSize={30} className="border-x border-[--color-border]">
            <EditorTabs />
          </Panel>
          {(showDia || showChat) && <HHandle />}
        </>

        {/* ③ 다이어그램 + 채팅 (수직 분할) */}
        {(showDia || showChat) && (
          <Panel defaultSize={30} minSize={18}>
            <PanelGroup direction="vertical">

              {/* ③-1 다이어그램 */}
              {showDia && (
                <>
                  <Panel defaultSize={70} minSize={30}>
                    {current && <DiagramViewer filePath={current.path} />}
                  </Panel>
                  {showChat && <VHandle />}
                </>
              )}

              {/* ③-2 채팅 */}
              {showChat && (
                <Panel defaultSize={30} minSize={20}>
                  <ChatUI />
                </Panel>
              )}

            </PanelGroup>
          </Panel>
        )}
      </PanelGroup>
    </div>
  );
}

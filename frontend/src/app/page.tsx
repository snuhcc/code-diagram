'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useFS } from '@/store/files';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import IconBar      from '@/components/IconBar';
import FileExplorer from '@/components/FileExplorer';

const EditorTabs    = dynamic(() => import('@/components/EditorTabs'),    { ssr: false });
const DiagramViewer = dynamic(() => import('@/components/DiagramViewer'), { ssr: false });
const ChatUI        = dynamic(() => import('@/components/ChatUI'),        { ssr: false });

/* ─── Resize handles ────────────────────────────────────────────── */
const HHandle = () => (
  <PanelResizeHandle className="w-[4px] bg-slate-300 hover:bg-sky-600 cursor-col-resize transition-colors" />
);
const VHandle = () => (
  <PanelResizeHandle className="h-[4px] bg-slate-300 hover:bg-sky-600 cursor-row-resize transition-colors" />
);

export default function Home() {
  const { current }         = useFS();
  const [showExp, setExp]   = useState(true);
  const [showDia, setDia]   = useState(true);
  const [showChat, setChat] = useState(true);

  return (
    <div className="flex h-full">
      {/* ─── Activity / Icon bar ─────────────────────────────────── */}
      <IconBar
        states={{ exp: showExp, dia: showDia, chat: showChat }}
        toggle={{
          exp:  () => setExp(!showExp),
          dia:  () => setDia(!showDia),
          chat: () => setChat(!showChat),
        }}
      />

      {/* ─── Main panel group (horizontal) ───────────────────────── */}
      <PanelGroup direction="horizontal" className="flex-1">

        {/* ─── File-explorer column ──────────────────────────────── */}
        {showExp && (
          <>
            <Panel defaultSize={15} minSize={12}>
              <FileExplorer />
            </Panel>
            <HHandle />
          </>
        )}

        {/* ─── Code-editor column ────────────────────────────────── */}
        <Panel defaultSize={55} minSize={30} className="border-x border-slate-300">
          <EditorTabs />
        </Panel>

        {(showDia || showChat) && <HHandle />}

        {/* ─── Diagram / Chat column (vertical split) ────────────── */}
        {(showDia || showChat) && (
          <Panel defaultSize={30} minSize={18} className="flex-1 min-w-0">
            <PanelGroup direction="vertical">

              {/* ── Diagram viewer ─────────────────────────────── */}
              {showDia && (
                <>
                  <Panel defaultSize={70} minSize={30}>
                    {current && <DiagramViewer filePath={current.path} />}
                  </Panel>
                  {showChat && <VHandle />}
                </>
              )}

              {/* ── Chat UI ─────────────────────────────────────── */}
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

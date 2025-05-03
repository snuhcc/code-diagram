// src/app/page.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useFS } from '@/store/files';
import { Panel, PanelGroup } from 'react-resizable-panels';

import IconBar      from '@/components/IconBar';
import FileExplorer from '@/components/FileExplorer';

const CodeViewer    = dynamic(()=>import('@/components/CodeViewer'),    { ssr:false });
const DiagramViewer = dynamic(()=>import('@/components/DiagramViewer'), { ssr:false });
const ChatUI        = dynamic(()=>import('@/components/ChatUI'),        { ssr:false });

export default function Home() {
  const { current } = useFS();
  const [showExp,  setExp]  = useState(true);
  const [showDia,  setDia]  = useState(true);
  const [showChat, setChat] = useState(true);

  return (
    <div className="flex h-full">
      <IconBar
        states={{ exp:showExp, dia:showDia, chat:showChat }}
        toggle={{
          exp:  () => setExp(!showExp),
          dia:  () => setDia(!showDia),
          chat: () => setChat(!showChat),
        }}
      />

      <PanelGroup direction="horizontal" className="flex-1">
        {showExp && (
          <Panel defaultSize={20} minSize={14}>
            <FileExplorer/>
          </Panel>
        )}

        <Panel minSize={40} className="border-x border-[--color-border]">
          {current && <CodeViewer filePath={current.path} />}
        </Panel>

        {(showDia || showChat) && (
          <Panel defaultSize={30} minSize={18}>
            <PanelGroup direction="vertical">
              {showDia && (
                <Panel defaultSize={70} minSize={30}>
                  {current && <DiagramViewer filePath={current.path} />}
                </Panel>
              )}
              {showChat && (
                <Panel minSize={20}>
                  <ChatUI/>
                </Panel>
              )}
            </PanelGroup>
          </Panel>
        )}
      </PanelGroup>
    </div>
  );
}

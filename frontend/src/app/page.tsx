'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useFS } from '@/store/files';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import IconBar from '@/components/IconBar';
import FileExplorer from '@/components/FileExplorer';
import SearchPanel from '@/components/SearchPanel';

const EditorTabs = dynamic(() => import('@/components/EditorTabs'), { ssr: false });
const DiagramViewer = dynamic(() => import('@/components/DiagramViewer'), { ssr: false });
const ChatUI = dynamic(() => import('@/components/ChatUI'), { ssr: false });

const HHandle = () => (
  <PanelResizeHandle className="w-[4px] bg-slate-300 hover:bg-sky-600 cursor-col-resize transition-colors" />
);
const VHandle = () => (
  <PanelResizeHandle className="h-[4px] bg-slate-300 hover:bg-sky-600 cursor-row-resize transition-colors" />
);

export default function Home() {
  const { current } = useFS();
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarContent, setSidebarContent] = useState<'explorer' | 'search'>('explorer');
  const [showDia, setDia] = useState(true);
  const [showChat, setChat] = useState(true);

  useEffect(() => {
    setSidebarContent('explorer');
    setShowSidebar(true);
  }, []);

  const toggleExplorer = () => {
    if (sidebarContent === 'explorer' && showSidebar) {
      setShowSidebar(false);
    } else {
      setSidebarContent('explorer');
      setShowSidebar(true);
    }
  };

  const toggleSearch = () => {
    if (sidebarContent === 'search' && showSidebar) {
      setShowSidebar(false);
    } else {
      setSidebarContent('search');
      setShowSidebar(true);
    }
  };

  const toggleDia = () => setDia(!showDia);
  const toggleChat = () => setChat(!showChat);

  return (
    <div className="flex h-full">
      <IconBar
        states={{
          explorer: sidebarContent === 'explorer' && showSidebar,
          search: !(sidebarContent === 'search' && showSidebar),
          diagram: showDia,
          chat: showChat,
        }}
        toggle={{
          explorer: toggleExplorer,
          search: toggleSearch,
          diagram: toggleDia,
          chat: toggleChat,
        }}
      />
      <PanelGroup direction="horizontal" className="flex-1">
        {showSidebar && (
          <>
            <Panel defaultSize={15} minSize={12}>
              {sidebarContent === 'explorer' ? <FileExplorer /> : <SearchPanel />}
            </Panel>
            <HHandle />
          </>
        )}
        <Panel defaultSize={55} minSize={30} className="border-x border-slate-300">
          <EditorTabs />
        </Panel>
        {(showDia || showChat) && <HHandle />}
        {(showDia || showChat) && (
          <Panel defaultSize={30} minSize={18} className="flex-1 min-w-0">
            <PanelGroup direction="vertical">
              {showDia && (
                <>
                  <Panel defaultSize={70} minSize={30}>
                    <DiagramViewer />
                  </Panel>
                  {showChat && <VHandle />}
                </>
              )}
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
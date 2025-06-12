'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useFS } from '@/store/files';
import { useEditor } from '@/store/editor';
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
  const { tabs } = useEditor(); // tabs 상태 가져오기
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

  // 탭이 있는지 확인
  const hasOpenTabs = tabs.length > 0;

  return (
    <div className="flex h-full">
      <IconBar
        states={{
          explorer: sidebarContent === 'explorer' && showSidebar,
          search: sidebarContent === 'search' && showSidebar,
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
              <PanelGroup direction="vertical">
                <Panel defaultSize={showChat ? 70 : 100} minSize={30}>
                  {sidebarContent === 'explorer' ? <FileExplorer /> : <SearchPanel />}
                </Panel>
                {showChat && (
                  <>
                    <VHandle />
                    <Panel defaultSize={30} minSize={20}>
                      <ChatUI />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>
            <HHandle />
          </>
        )}
        
        {/* 에디터 패널 - 탭이 없으면 크기가 0 */}
        <Panel 
          defaultSize={hasOpenTabs ? 55 : 0} 
          minSize={hasOpenTabs ? 30 : 0}
          maxSize={hasOpenTabs ? 70 : 0}
          className={hasOpenTabs ? "border-x border-slate-300" : ""}
        >
          {hasOpenTabs && <EditorTabs />}
        </Panel>
        
        {/* 에디터와 다이어그램 사이의 핸들 - 탭이 있을 때만 표시 */}
        {hasOpenTabs && showDia && <HHandle />}
        
        {/* 다이어그램 패널 - 항상 존재하지만 크기가 변함 */}
        {showDia && (
          <Panel 
            defaultSize={hasOpenTabs ? 45 : 85} 
            minSize={hasOpenTabs ? 18 : 30}
          >
            <DiagramViewer />
          </Panel>
        )}
      </PanelGroup>
    </div>
  );
}
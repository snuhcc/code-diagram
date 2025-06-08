'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  applyNodeChanges,
  NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nanoid } from 'nanoid';
import { useEditor } from '@/store/editor';
import { useFS, type FileNode } from '@/store/files';
import { NodeProps } from '@xyflow/react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css'; // 원하는 스타일로 변경 가능

hljs.registerLanguage('python', python);

// Global cache for diagram data and snippets
let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const snippetCache = new Map<string, string>(); // <cleanPath_functionName, preview>

// Dagre layout utility
function layout(nodes: Node[] = [], edges: Edge[] = []): Node[] {
  const g = new dagre.graphlib.Graph().setGraph({
    rankdir: 'TB',
    nodesep: 100, // 수평 간격 증가로 그룹 노드 겹침 방지
    ranksep: 100, // 수직 간격 증가로 그룹 노드 겹침 방지
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => g.setNode(n.id, { width: 160, height: 40 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x, y } };
  });
}

function layoutWithCluster(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
    .setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 140 })  // 간격 ↑
    .setDefaultEdgeLabel(() => ({}));

  /* 1️⃣ 파일을 클러스터로 */
  Object.keys(files).forEach((file) => {
    g.setNode(`cluster_${file}`, {});  // 크기는 Dagre가 계산
  });

  /* 2️⃣ 함수 노드 + 부모 설정 */
  Object.entries(files).forEach(([file, { nodes }]) => {
    nodes.forEach((n) => {
      g.setNode(n.id, { width: 160, height: 40 });
      g.setParent(n.id, `cluster_${file}`);
    });
  });

  /* 3️⃣ 엣지 추가 */
  Object.values(files).forEach(({ edges }) => {
    edges.forEach(({ source, target }) => g.setEdge(source, target));
  });

  dagre.layout(g);

  /* 4️⃣ 좌표 맵 추출 */
  const pos: Record<string, { x: number; y: number }> = {};
  g.nodes().forEach((id: string) => {
    const n = g.node(id);
    if (n?.x != null && n?.y != null) pos[id] = { x: n.x, y: n.y };
  });
  return pos;
}


// Common types
interface RawNode {
  id: string;
  label?: string;
  function_name?: string;
  file: string;
}
interface RawEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

// API endpoint
const ENDPOINT_CG = '/api/generate_call_graph';
const ENDPOINT_CFG = '/api/generate_control_flow_graph';
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';

// Custom group node component
function CustomGroupNode({ data, style }: NodeProps) {
  return (
    <div style={{ position: 'relative', width: style?.width, height: style?.height }}>
      {/* Label above the group box */}
      <div
        style={{
          position: 'absolute',
          top: -32, // 기존 -22에서 -32로 더 위로 올림
          left: 0,
          width: '100%',
          textAlign: 'center',
          fontWeight: 600,
          fontSize: 13,
          color: '#444',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {data?.label}
      </div>
      {/* Group box */}
      <div
        style={{
          width: '100%',
          height: '100%',
          background: style?.background,
          border: style?.border,
          borderRadius: style?.borderRadius,
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

export default function DiagramViewer() {
  // State
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null); // ⭐️ 추가
  const [cfgMessage, setCfgMessage] = useState<string | null>(null); // ⭐️ 메시지 상태 추가
  const [cfgPanels, setCfgPanels] = useState<
    { id: string; functionName: string; file: string; result: any; expanded: boolean; pos: { x: number; y: number }; dragging: boolean; dragOffset: { x: number; y: number } }[]
  >([]);
  // ⭐️ CFG 버튼 로딩 상태
  const [cfgLoading, setCfgLoading] = useState(false);

  // Zustand stores
  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  // Current active file path
  const activePath =
    editorState.tabs.find((t) => t.id === editorState.activeId)?.path ??
    editorState.tabs.at(-1)?.path ??
    '';

  // Utility to extract function snippet and its starting line number from code
  function extractFunctionSnippetWithLine(code: string, functionName: string): { snippet: string, startLine: number } | null {
    const lines = code.split('\n');
    let startLine = -1;

    // Find the start of the function definition at indentation level 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith(`def ${functionName}(`)) {
        if (line === line.trim()) { // No leading spaces
          startLine = i;
          break;
        }
      }
    }

    if (startLine === -1) {
      return null;
    }

    // Find the end of the function (next line with indentation 0)
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        continue;
      }
      if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
        return {
          snippet: lines.slice(startLine, i).join('\n'),
          startLine: startLine + 1, // 1-based line number
        };
      }
    }
    return {
      snippet: lines.slice(startLine).join('\n'),
      startLine: startLine + 1,
    };
  }

  // Utility to add line numbers and syntax highlight to code snippet
  function addLineNumbersAndHighlight(snippet: string, start: number = 1): string {
    // highlight.js로 syntax highlight 적용
    const highlighted = hljs.highlight(snippet, { language: 'python' }).value;
    // 줄 단위로 쪼개서 라인넘버 span 추가
    const lines = highlighted.split('\n');
    const pad = String(start + lines.length - 1).length;
    return lines
      .map((line, idx) => {
        const num = String(start + idx).padStart(pad, ' ');
        return `<span style="color:#64748b">${num}</span>  ${line}`;
      })
      .join('\n');
  }

  // Node click handler: open file in editor and highlight in explorer
  const onNodeClick: NodeMouseHandler = (_, node) => {
    // 그룹 노드 클릭 시: 선택 상태 변경하지 않음
    if (node.type === 'group') {
      // 그룹 노드는 선택 상태를 변경하지 않음
      // 파일 경로를 찾기 위해 nodes에서 해당 그룹의 파일 경로를 역추적
      // 그룹 노드 id: group-<file_path_escaped>
      // nodes 중 parentId가 node.id인 첫번째 노드의 file을 사용
      const childNode = nodes.find(n => n.parentId === node.id);
      const filePath = childNode ? (childNode.data as any)?.file : undefined;
      if (!filePath) return;

      const clean = filePath.replace(/^poc[\\/]/, '');
      editorState.open({
        id: nanoid(),
        path: clean,
        name: clean.split(/[\\/]/).pop() ?? clean,
        // 첫번째 라인으로 이동 (예시: line: 1)
        line: 1,
      });

      const target = findByPath(fsState.tree, clean);
      if (target) fsState.setCurrent(target.id);
      return;
    }

    // 함수 노드만 선택 상태 토글
    setSelectedNodeId(prev => prev === node.id ? null : node.id);

    // 기존 함수 노드 클릭 동작
    const raw = (node.data as any)?.file as string | undefined;
    if (!raw) return;

    const clean = raw.replace(/^poc[\\/]/, '');
    editorState.open({
      id: nanoid(),
      path: clean,
      name: clean.split(/[\\/]/).pop() ?? clean,
    });

    const target = findByPath(fsState.tree, clean);
    if (target) fsState.setCurrent(target.id);
  };

  // Hover handlers
  const onEnter: NodeMouseHandler = async (_, node) => {
    setHoverId(node.id);

    const raw = (node.data as any)?.file as string | undefined;
    const functionName = (node.data as any)?.label as string | undefined;

    if (!raw || !functionName) {
      setSnippet('');
      return;
    }

    const clean = raw.replace(/^poc[\\/]/, '');
    const cacheKey = `${clean}_${functionName}`;

    if (snippetCache.has(cacheKey)) {
      try {
        const txt = await fetch(
          `/api/file?path=${encodeURIComponent(clean)}`
        ).then((r) => r.text());
        const result = extractFunctionSnippetWithLine(txt, functionName);
        if (result) {
          setSnippet(addLineNumbersAndHighlight(result.snippet, result.startLine));
        } else {
          setSnippet('(function not found)');
        }
      } catch {
        setSnippet('(preview unavailable)');
      }
      return;
    }

    try {
      const txt = await fetch(
        `/api/file?path=${encodeURIComponent(clean)}`
      ).then((r) => r.text());

      const result = extractFunctionSnippetWithLine(txt, functionName);
      if (result) {
        snippetCache.set(cacheKey, result.snippet);
        setSnippet(addLineNumbersAndHighlight(result.snippet, result.startLine));
      } else {
        setSnippet('(function not found)');
      }
    } catch {
      setSnippet('(preview unavailable)');
    }
  };

  const onLeave: NodeMouseHandler = () => {
    setHoverId(null);
    setSnippet('');
  };

  // Handle node changes (dragging, etc.)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );

  // Load diagram data and cache it
  useEffect(() => {
    (async () => {
      if (diagramCache) {
        hydrate(diagramCache);
        setLoad(false);
        return;
      }

      setLoad(true);
      setErr(undefined);

      try {
        const res = await fetch(`${apiUrl}${ENDPOINT_CG}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '../../poc', file_type: 'py' }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const raw = await res.json();
        const json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> =
          typeof raw?.data === 'string' ? JSON.parse(raw.data) : raw.data;

        diagramCache = json;
        hydrate(json);
      } catch (e: any) {
        setErr(String(e));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoad(false);
      }
    })();
  }, []);

  // Compute node styles
  const finalNodes = nodes.map((n) => {
    const clean = (n.data as any)?.file?.replace(/^poc[\\/]/, ''); 
    const isActive = clean === activePath;
    const isHover = hoverId === n.id;
    const isSelected = selectedNodeId === n.id;
    if (n.type === 'group') {
      return {
        ...n,
        style: {
          ...n.style,
          background: isHover
            ? '#fef9c3'
            : isSelected
              ? '#fca5a5'
              : isActive
                ? '#dbeafe'
                : '#ffffff',
          border: isHover
            ? '2px solid #eab308'
              : isActive
                ? '2px solid #fb923c'
                : '1px solid #fb923c',
        },
      };
    }
    // 일반 노드
    return {
      ...n,
      style: {
        ...n.style,
        background: isHover
          ? '#fef9c3'
          : isSelected
            ? '#fca5a5'
            : isActive
              ? '#dbeafe'
              : '#ffffff',
        border: isHover
          ? '2px solid #eab308'
          : isSelected
            ? '2px solid #b91c1c'
            : isActive
              ? '2px solid #0284c7'
              : '1px solid #3b82f6',
        transition: 'all 0.1s ease-in-out',
      },
    };
  });

  // 레이아웃 재적용 함수
  const reLayout = useCallback(() => {
    if (diagramCache) {
      // 기존에 받아온 JSON 캐시를 다시 hydrate하여 layoutWithCluster 로직 전체 재실행
      hydrate(diagramCache);
    }
  }, []);

  // ⭐️ Control Flow Graph 버튼 핸들러 구현 (복수 패널 지원)
  const handleGenerateCFG = async () => {
    setCfgMessage(null);
    setCfgLoading(true);

    // 선택된 노드 찾기 (group 타입이 아닌 함수 노드만)
    const selectedNode = nodes.find(n => n.id === selectedNodeId && n.type !== 'group');
    if (!selectedNode) {
      setCfgMessage('선택된 노드가 없습니다.');
      setCfgLoading(false);
      return;
    }
    const file = (selectedNode.data as any)?.file;
    const functionName = (selectedNode.data as any)?.label;
    if (!file || !functionName) {
      setCfgMessage('노드 정보가 올바르지 않습니다.');
      setCfgLoading(false);
      return;
    }
    try {
      const res = await fetch(`${apiUrl}${ENDPOINT_CFG}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: file.replace(/^poc[\\/]/, ''),
          function_name: functionName,
        }),
      });
      const data = await res.json();
      if (data.status && data.status !== 200) {
        setCfgMessage('API 호출 실패: ' + (data.data || ''));
      } else {
        // CFG JSON을 React Flow 노드/엣지로 변환
        const cfgRaw = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        // 예시: { nodes: [{id, label}], edges: [{id, source, target}] }
        let cfgNodes = (cfgRaw.nodes || []).map((n: any) => ({
          id: n.id,
          data: { label: n.label || n.id },
          position: { x: n.x ?? 0, y: n.y ?? 0 },
          style: {
            padding: 4,
            borderRadius: 3,
            border: '1px solid #0284c7',
            background: '#fff',
            fontSize: 12,
            minWidth: 40,
            minHeight: 24,
          },
        }));
        const cfgEdges = (cfgRaw.edges || []).map((e: any) => ({
          id: e.id || `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          markerEnd: { type: MarkerType.ArrowClosed },
          animated: true,
          style: { stroke: '#0284c7', strokeWidth: 2 },
        }));

        // layout 적용 (x/y 모두 0이거나 누락된 경우만)
        if (
          cfgNodes.length > 0 &&
          cfgNodes.every(n => (!n.position.x && !n.position.y))
        ) {
          cfgNodes = layout(cfgNodes, cfgEdges);
        }

        // 패널 id는 file+functionName+timestamp로 유니크하게
        const id = `${file}__${functionName}__${Date.now()}`;
        setCfgPanels(panels => [
          ...panels,
          {
            id,
            functionName,
            file,
            result: { nodes: cfgNodes, edges: cfgEdges },
            expanded: true,
            pos: { x: 24 + panels.length * 32, y: 24 + panels.length * 32 },
            dragging: false,
            dragOffset: { x: 0, y: 0 },
          },
        ]);
        setCfgMessage(null);
      }
    } catch (e: any) {
      setCfgMessage('API 호출 중 오류가 발생했습니다.');
    } finally {
      setCfgLoading(false);
    }
  };

  // Loading and error states
  if (loading)
    return (
      <div className="flex items-center justify-center h-full w-full">
        <svg
          className="animate-spin h-8 w-8 text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <span className="ml-3 text-sm text-slate-500">diagram loading…</span>
      </div>
    );
  if (error)
    return (
      <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
    );

  // Render
  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={finalNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onEnter}
        onNodeMouseLeave={onLeave}
        fitView
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50"
        nodeTypes={{
          group: CustomGroupNode, // Register custom group node
        }}
        onPaneClick={() => setSelectedNodeId(null)} // 빈 공간 클릭 시 선택 해제
      >
        <Background variant="dots" gap={16} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={n =>
            n.type === 'group'
              ? '#bdbdbd'
              : n.style?.background === '#fef9c3'
                ? '#facc15'
                : n.style?.background === '#dbeafe'
                  ? '#0284c7'
                  : '#2563eb'
          }
          nodeStrokeColor={n =>
            n.type === 'group'
              ? '#757575'
              : n.style?.border?.includes('#eab308')
                ? '#eab308'
                : n.style?.border?.includes('#0284c7')
                  ? '#0284c7'
                  : '#1e40af'
          }
          nodeStrokeWidth={2}
          maskColor="rgba(255,255,255,0.7)"
          style={{
            background: '#f3f4f6', // 밝은 회색 배경 (tailwind gray-100)
            border: '1.5px solid #cbd5e1', // 테두리 (tailwind slate-300)
            borderRadius: 6,
            boxShadow: '0 2px 8px #0002',
          }}
        />
        <Controls>
          {/* ...기존 +, -, 잠금 버튼 등... */}
          <button
            type="button"
            title="Re-layout"
            onClick={reLayout}
            style={{
              width: 20,
              height: 20,
              background: '#fff',
              padding: 0,
              margin: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px #0001',
              transition: 'border 0.15s',
            }}
          >
            {/* 흑백 단색 레이아웃(정렬) 아이콘 */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="4" height="4" rx="1" fill="#222" />
              <rect x="10" y="2" width="4" height="4" rx="1" fill="#222" />
              <rect x="2" y="10" width="4" height="4" rx="1" fill="#222" />
              <rect x="6" y="6" width="4" height="4" rx="1" fill="#222" />
              <rect x="10" y="10" width="4" height="4" rx="1" fill="#222" />
            </svg>
          </button>
          <button
            type="button"
            title="Generate Control Flow Graph"
            onClick={handleGenerateCFG}
            disabled={cfgLoading}
            style={{
              width: 20,
              height: 20,
              background: '#fff',
              padding: 0,
              margin: 4,
              cursor: cfgLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px #0001',
              transition: 'border 0.15s',
              position: 'relative',
            }}
          >
            {/* 그래프 생성 느낌의 아이콘 (노드+엣지+플러스) - 검은색 */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: cfgLoading ? 0.3 : 1 }}>
              <circle cx="6" cy="6" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2"/>
              <circle cx="14" cy="6" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2"/>
              <circle cx="10" cy="14" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2"/>
              <line x1="7.5" y1="7.5" x2="10" y2="12" stroke="#222" strokeWidth="1.2"/>
              <line x1="12.5" y1="7.5" x2="10" y2="12" stroke="#222" strokeWidth="1.2"/>
              <line x1="8.2" y1="6" x2="11.8" y2="6" stroke="#222" strokeWidth="1.2"/>
              <g>
                <circle cx="16.5" cy="16.5" r="3.2" fill="#222"/>
                <rect x="16" y="14.2" width="1" height="4.6" rx="0.5" fill="#fff"/>
                <rect x="14.2" y="16" width="4.6" height="1" rx="0.5" fill="#fff"/>
              </g>
            </svg>
            {/* 로딩 스피너 */}
            {cfgLoading && (
              <span
                style={{
                  position: 'absolute',
                  left: 0, top: 0, width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.7)',
                  borderRadius: 4,
                }}
              >
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16">
                  <circle
                    cx="8" cy="8" r="6"
                    stroke="#0284c7"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray="28"
                    strokeDashoffset="10"
                  />
                </svg>
              </span>
            )}
          </button>
        </Controls>
      </ReactFlow>

      {/* ⭐️ Control Flow Graph 메시지/결과 표시 */}
      {cfgMessage && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 24,
            background: '#fee2e2',
            color: '#b91c1c',
            padding: '8px 16px',
            borderRadius: 6,
            zIndex: 100,
            fontSize: 14,
            boxShadow: '0 2px 8px #0002',
          }}
        >
          {cfgMessage}
        </div>
      )}

      {/* ⭐️ 복수 패널 지원 */}
      {cfgPanels.map((panel, idx) => (
        <div
          key={panel.id}
          style={{
            position: 'fixed',
            top: panel.pos.y,
            right: panel.pos.x,
            background: '#f1f5f9',
            color: '#222',
            padding: panel.expanded ? '12px 18px 18px 18px' : '8px 18px 8px 18px',
            borderRadius: 8,
            zIndex: 200 + idx,
            fontSize: 13,
            minWidth: 220,
            maxWidth: 600,
            minHeight: panel.expanded ? 0 : 0,
            maxHeight: panel.expanded ? 600 : 44,
            boxShadow: '0 2px 8px #0002',
            whiteSpace: 'pre-wrap',
            overflow: panel.expanded ? 'auto' : 'hidden',
            transition: 'all 0.2s cubic-bezier(.4,2,.6,1)',
            display: 'flex',
            flexDirection: 'column',
            cursor: panel.dragging ? 'move' : 'default',
            userSelect: panel.dragging ? 'none' : 'auto',
          }}
          onMouseMove={e => {
            if (panel.dragging) {
              setCfgPanels(panels =>
                panels.map(p =>
                  p.id === panel.id
                    ? {
                        ...p,
                        pos: {
                          x: window.innerWidth - e.clientX - p.dragOffset.x,
                          y: e.clientY - p.dragOffset.y,
                        },
                      }
                    : p
                )
              );
            }
          }}
          onMouseUp={() => {
            if (panel.dragging) {
              setCfgPanels(panels =>
                panels.map(p =>
                  p.id === panel.id ? { ...p, dragging: false } : p
                )
              );
            }
          }}
        >
          {/* 헤더: 드래그 핸들 + expand/collapse/close */}
          <div
            style={{
              width: '100%',
              minHeight: 28,
              display: 'flex',
              alignItems: 'center',
              fontWeight: 600,
              fontSize: 13,
              color: '#555',
              userSelect: 'none',
              marginBottom: panel.expanded ? 8 : 0,
              gap: 4,
              cursor: 'move',
            }}
            onMouseDown={e => {
              setCfgPanels(panels =>
                panels.map(p =>
                  p.id === panel.id
                    ? {
                        ...p,
                        dragging: true,
                        dragOffset: {
                          x: window.innerWidth - e.clientX - (p.pos.x || 24),
                          y: e.clientY - (p.pos.y || 24),
                        },
                      }
                    : p
                )
              );
              e.preventDefault();
            }}
          >
            <span style={{ flex: 1 }}>
              CFG ({panel.functionName})
            </span>
            <button
              onClick={e => {
                e.stopPropagation();
                setCfgPanels(panels =>
                  panels.map(p =>
                    p.id === panel.id ? { ...p, expanded: !p.expanded } : p
                  )
                );
              }}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 16,
                color: '#888',
                cursor: 'pointer',
                padding: 0,
                marginRight: 4,
                lineHeight: 1,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.15s',
                transform: panel.expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
              aria-label={panel.expanded ? 'Collapse' : 'Expand'}
              title={panel.expanded ? 'Collapse' : 'Expand'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="#888" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              onClick={e => {
                e.stopPropagation();
                setCfgPanels(panels => panels.filter(p => p.id !== panel.id));
              }}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 16,
                color: '#888',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>
          {panel.expanded && (
            <div style={{ width: '100%', overflow: 'auto' }}>
              {panel.result && panel.result.nodes && panel.result.edges ? (
                <div style={{ width: 400, height: 320, background: '#f8fafc', borderRadius: 6 }}>
                  <ReactFlow
                    nodes={panel.result.nodes}
                    edges={panel.result.edges}
                    fitView
                    minZoom={0.2}
                    maxZoom={2}
                    className="bg-gray-50"
                    style={{ width: '100%', height: '100%' }}
                  >
                    <Background variant="dots" gap={16} size={1} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              ) : (
                <pre style={{
                  margin: 0,
                  fontSize: 13,
                  background: 'none',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxWidth: 560,
                  maxHeight: 520,
                  padding: 0,
                }}>
                  {typeof panel.result === 'string' ? panel.result : JSON.stringify(panel.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
      {/* Code snippet panel */}
      {hoverId && snippet && (
        <div
          className="fixed z-50"
          style={{
            top: 16,
            right: 16,
            minWidth: 320,
            maxWidth: '40vw',
            width: 'auto',
            minHeight: 40,
            maxHeight: '80vh',
            background: '#fafafa', // atom-one-light에 어울리는 밝은 배경
            color: '#1e293b',
            fontSize: 12,
            borderRadius: 8,
            boxShadow: '0 4px 16px #0004',
            padding: 16,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
          // highlight.js 스타일 적용을 위해 hljs 클래스 추가
          dangerouslySetInnerHTML={{ __html: `<pre class="hljs">${snippet}</pre>` }}
        />
      )}
    </div>
  );

  function hydrate(json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>) {
    let allFunctionNodes: Node[] = [];
    let allRawEdges: RawEdge[] = [];

    // Step 1: Collect all function nodes and all edges from JSON
    Object.entries(json).forEach(([file, data]) => {
      const { nodes: rawNodes, edges: rawEdges } = data;

      const fileFunctionNodes: Node[] = rawNodes.map((r) => ({
        id: r.id,
        data: { label: r.label || r.function_name || r.id, file: r.file },
        position: { x: 0, y: 0 },
        style: {
          padding: 6,
          borderRadius: 4,
          border: '1px solid #3b82f6',
          background: '#fff',
        },
        zIndex: 1, // Function nodes above group nodes
      }));

      allFunctionNodes = allFunctionNodes.concat(fileFunctionNodes);
      allRawEdges = allRawEdges.concat(rawEdges);
    });

    // Step 2: 전체 노드 id 집합 생성
    const allNodeIds = new Set(allFunctionNodes.map((n) => n.id));

    // Step 3: edge의 source/target이 전체 노드에 있으면 추가 (cross-file edge 지원)
    const allEdges: Edge[] = allRawEdges
      .filter((e) => allNodeIds.has(e.source) && allNodeIds.has(e.target))
      .map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          width: 15, // 화살표 크기 증가
          height: 15, // 화살표 크기 증가
          color: '#905adb', // 더 진한 파란색
        },
        animated: true,
        style: { stroke: '#905adb', strokeWidth: 2 }, // 파란색, 두께 증가
        zIndex: 10000, // Edges above all nodes, including during drag
        // type: 'smoothstep', // Smooth step edges for better appearance
      }));

    // Step 2: Dagre를 사용해 모든 함수 노드 배치
    const posMap = layoutWithCluster(json);       // ← 새 클러스터 레이아웃
    const laidOutFunctionNodes = allFunctionNodes.map((n) => ({
      ...n,
      position: posMap[n.id] ?? { x: 0, y: 0 },
    }));

    // Step 3: 파일별 그룹 노드 생성
    const groupNodes: Node[] = [];
    const padding = 20;
    const fileToNodes: Record<string, Node[]> = {};

    // 파일별로 함수 노드 그룹화
    laidOutFunctionNodes.forEach((node) => {
      const file = (node.data as any).file;
      if (!fileToNodes[file]) {
        fileToNodes[file] = [];
      }
      fileToNodes[file].push(node);
    });

    // Step 4: 그룹 노드 생성 및 자식 노드 위치 조정
    Object.entries(fileToNodes).forEach(([file, nodes]) => {
      if (nodes.length === 0) return;

      // 그룹의 경계 상자 계산
      const xs = nodes.map((n) => n.position.x);
      const ys = nodes.map((n) => n.position.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs) + 160; // 대략적인 노드 너비
      const maxY = Math.max(...ys) + 40;  // 대략적인 노드 높이

      const groupId = `group-${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
      groupNodes.push({
        id: groupId,
        type: 'group', // This will use CustomGroupNode
        data: { label: file.split('/').pop() || file },
        position: { x: minX - padding, y: minY - padding },
        style: {
          width: maxX - minX + 2 * padding,
          height: maxY - minY + 2 * padding,
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px dashed #fb923c',
          borderRadius: 8,
        },
        zIndex: 0, // Group nodes below function nodes and edges
      });

      // 함수 노드 위치를 그룹 기준으로 조정
      nodes.forEach((node) => {
        node.position = {
          x: node.position.x - (minX - padding),
          y: node.position.y - (minY - padding),
        };
        node.parentId = groupId;
        node.extent = 'parent';
      });
    });

    // Step 5: 그룹 노드와 함수 노드 결합 후 상태 설정
    const allNodes = [...groupNodes, ...laidOutFunctionNodes];
    setNodes(allNodes);
    setEdges(allEdges);
  }
}

// Utility to find FileNode by path
function findByPath(nodes: FileNode[] = [], p: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path?.replace(/^poc[\\/]/, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}
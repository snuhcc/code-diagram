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
import 'highlight.js/styles/atom-one-light.css';

hljs.registerLanguage('python', python);

// Helper function to estimate text width
function getTextWidth(text: string, font: string = '12px Arial'): number {
  // Ensure this runs client-side
  if (typeof document === 'undefined') return text.length * 7; // SSR fallback, rough estimate
  const canvas = (getTextWidth as any).canvas || ((getTextWidth as any).canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) {
    return text.length * 7; // Fallback if context cannot be obtained
  }
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
}
(getTextWidth as any).canvas = null; // Initialize canvas property for caching

let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const snippetCache = new Map<string, string>();

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

const ENDPOINT_CG = '/api/generate_call_graph';
const ENDPOINT_CFG = '/api/generate_control_flow_graph';
const ENDPOINT_INLINE_CODE_EXPLANATION = '/api/inline_code_explanation';
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER;

/**
 * 다이어그램 노드와 엣지를 화면 크기에 맞게 배치하는 함수
 * @param files 파일별 노드와 엣지 데이터
 * @param nodeWidths 각 노드의 미리 계산된 너비
 * @returns 노드 ID와 위치(x, y) 매핑
 */
function layoutWithCluster(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>,
  nodeWidths: Record<string, number> // New parameter
): Record<string, { x: number; y: number }> {
  // 전체 파일과 노드 수 계산
  const totalFiles = Object.keys(files).length;
  const totalNodes = Object.values(files).reduce((sum, f) => sum + f.nodes.length, 0);
  
  // 화면 크기에 맞춘 최대 너비 설정 (화면 너비의 80%)
  const maxWidth = window.innerWidth * 0.8;
  
  // Use an average estimated width for maxNodesPerRank calculation
  const averageNodeWidth = Object.values(nodeWidths).length > 0 
    ? Object.values(nodeWidths).reduce((sum, w) => sum + w, 0) / Object.values(nodeWidths).length
    : (totalNodes > 50 ? 100 : 120); // Fallback if nodeWidths is empty or not representative

  // 한 줄에 배치할 최대 노드 수 계산
  const maxNodesPerRank = Math.floor(maxWidth / (averageNodeWidth + 30)); // +30 for spacing
  
  // 노드 수에 따라 간격 동적 조정
  const nodesep = totalNodes > 50 ? 15 : totalNodes > 30 ? 20 : 25;
  const ranksep = totalNodes > 50 ? 40 : totalNodes > 30 ? 50 : 60;
  
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
    .setGraph({
      rankdir: 'TB', // 위에서 아래로 배치
      nodesep: nodesep,
      ranksep: ranksep,
      ranker: 'tight-tree', // 컴팩트한 트리 구조
      align: 'DL', // 왼쪽 정렬
      marginx: 10,
      marginy: 10,
    })
    .setDefaultEdgeLabel(() => ({}));
    
  // 파일별 클러스터 생성
  Object.keys(files).forEach((file) => {
    g.setNode(`cluster_${file}`, {
      marginx: 10,
      marginy: 10,
    });
  });
  
  // 각 파일의 노드와 엣지 처리
  Object.entries(files).forEach(([file, { nodes, edges }]) => {
    // 노드의 깊이 계산
    const nodeDepths = new Map<string, number>();
    const nodeChildren = new Map<string, string[]>();
    
    // 자식 노드 매핑
    edges.forEach(({ source, target }) => {
      if (!nodeChildren.has(source)) {
        nodeChildren.set(source, []);
      }
      nodeChildren.get(source)!.push(target);
    });
    
    // BFS로 깊이 할당
    const visited = new Set<string>();
    const queue: { node: string; depth: number }[] = [];
    const incomingEdges = new Set(edges.map(e => e.target));
    const rootNodes = nodes.filter(n => !incomingEdges.has(n.id));
    
    rootNodes.forEach(root => {
      queue.push({ node: root.id, depth: 0 });
    });
    
    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (visited.has(node)) continue;
      
      visited.add(node);
      nodeDepths.set(node, depth);
      
      const children = nodeChildren.get(node) || [];
      children.forEach(child => {
        queue.push({ node: child, depth: depth + 1 });
      });
    }
    
    // 깊이별 노드 그룹화
    const depthGroups = new Map<number, string[]>();
    nodeDepths.forEach((depth, nodeId) => {
      if (!depthGroups.has(depth)) {
        depthGroups.set(depth, []);
      }
      depthGroups.get(depth)!.push(nodeId);
    });
    
    // 깊이별로 노드 수가 많으면 세로로 분할
    let virtualNodeCount = 0;
    depthGroups.forEach((nodesAtDepth, depth) => {
      if (nodesAtDepth.length > maxNodesPerRank && depth > 0) {
        const chunks = [];
        for (let i = 0; i < nodesAtDepth.length; i += maxNodesPerRank) {
          chunks.push(nodesAtDepth.slice(i, i + maxNodesPerRank));
        }
        
        if (chunks.length > 1) {
          chunks.forEach((chunk, chunkIndex) => {
            const virtualNodeId = `virtual_${file}_${depth}_${virtualNodeCount++}`;
            g.setNode(virtualNodeId, {
              width: 1,
              height: 1,
              dummy: true,
            });
            g.setParent(virtualNodeId, `cluster_${file}`);
            
            // 부모 노드와 가상 노드 연결
            const parents = new Set<string>();
            chunk.forEach(nodeId => {
              edges.forEach(edge => {
                if (edge.target === nodeId) {
                  parents.add(edge.source);
                }
              });
            });
            
            parents.forEach(parent => {
              g.setEdge(parent, virtualNodeId, {
                weight: 0.1,
              });
            });
            
            // 가상 노드와 실제 노드 연결
            chunk.forEach(nodeId => {
              g.setEdge(virtualNodeId, nodeId, {
                weight: 10,
              });
            });
          });
        }
      }
    });
    
    // 실제 노드 추가
    nodes.forEach((n) => {
      const width = nodeWidths[n.id] || (totalNodes > 50 ? 100 : 120); // Use dynamic width from nodeWidths
      const height = totalNodes > 50 ? 35 : 40; // Height can remain fixed or be made dynamic
      
      g.setNode(n.id, { 
        width: width,
        height: height,
      });
      g.setParent(n.id, `cluster_${file}`);
    });
  });
  
  // 엣지 추가
  Object.values(files).forEach(({ edges }) => {
    edges.forEach(({ source, target }) => {
      if (!g.hasEdge(source, target)) {
        g.setEdge(source, target, {
          weight: 1,
        });
      }
    });
  });
  
  // 레이아웃 실행
  dagre.layout(g);
  
  // 위치 추출 (가상 노드 제외)
  const pos: Record<string, { x: number; y: number }> = {};
  g.nodes().forEach((id: string) => {
    const n = g.node(id);
    if (n && !n.dummy && n.x != null && n.y != null) {
      pos[id] = { x: n.x, y: n.y };
    }
  });
  
  return pos;
}

/**
 * 커스텀 그룹 노드 컴포넌트
 * @param data 그룹 노드 데이터
 */
function CustomGroupNode({ data }: NodeProps) {
  const { label, isCollapsed, onToggleCollapse } = data;

  // SVG chevron icon (right for collapsed, down for expanded)
  const ChevronIcon = ({ direction = 'down' }: { direction: 'down' | 'right' }) => (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#6366f1',
        transition: 'transform 0.15s',
        transform: direction === 'right' ? 'rotate(-90deg)' : 'none',
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  if (isCollapsed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: 13,
          color: '#444',
          cursor: 'pointer',
          gap: 8,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
      >
        <ChevronIcon direction="right" />
        <span style={{ display: 'flex', alignItems: 'center' }}>{label}</span>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: -32,
          left: 0,
          width: '100%',
          fontWeight: 600,
          fontSize: 13,
          color: '#444',
          pointerEvents: 'none',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 32,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'auto',
            height: '100%',
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              height: '1em',
            }}
          >
            <ChevronIcon direction="down" />
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              height: '1em',
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * 다이어그램 뷰어 컴포넌트
 */
export default function DiagramViewer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cfgMessage, setCfgMessage] = useState<string | null>(null);
  // ▼ 추가: CFG 패널 우측 상단에 표시할 메시지 상태
  const [cfgPanelMessage, setCfgPanelMessage] = useState<string | null>(null);
  const [cfgPanels, setCfgPanels] = useState<
    { id: string; functionName: string; file: string; result: any; expanded: boolean; pos: { x: number; y: number }; dragging: boolean; dragOffset: { x: number; y: number }; width?: number; height?: number; resizing?: boolean }[]
  >([]);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [diagramReady, setDiagramReady] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  const activePath =
    editorState.tabs.find((t) => t.id === editorState.activeId)?.path ??
    editorState.tabs.at(-1)?.path ??
    '';

  const onToggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  function isNodeHidden(nodeId: string, collapsedGroups: Set<string>, nodes: Node[]): boolean {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !node.parentId) return false;
    
    if (collapsedGroups.has(node.parentId)) {
      return true;
    }
    
    return isNodeHidden(node.parentId, collapsedGroups, nodes);
  }

  function extractFunctionSnippetWithLine(code: string, functionName: string): { snippet: string, startLine: number } | null {
    const lines = code.split('\n');
    let startLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith(`def ${functionName}(`) && line === line.trim()) {
        startLine = i;
        break;
      }
    }
    if (startLine === -1) return null;
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
        return { snippet: lines.slice(startLine, i).join('\n'), startLine: startLine + 1 };
      }
    }
    return { snippet: lines.slice(startLine).join('\n'), startLine: startLine + 1 };
  }

  function addLineNumbersAndHighlight(snippet: string, start: number = 1): string {
    const highlighted = hljs.highlight(snippet, { language: 'python' }).value;
    const lines = highlighted.split('\n');
    const pad = String(start + lines.length - 1).length;
    return lines
      .map((line, idx) => {
        const num = String(start + idx).padStart(pad, ' ');
        return `<span style="color:#64748b">${num}</span>  ${line}`;
      })
      .join('\n');
  }

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (node.type === 'group') {
      const childNode = nodes.find(n => n.parentId === node.id && !isNodeHidden(n.id, collapsedGroups, nodes));
      const filePath = childNode ? (childNode.data as any)?.file : (node.data as any)?.file;
      if (!filePath) return;
      const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
      const clean = filePath.replace(regex, '');
      editorState.open({
        id: nanoid(),
        path: clean,
        name: clean.split(/[\\/]/).pop() ?? clean,
        line: 1,
      });
      const target = findByPath(fsState.tree, clean);
      if (target) fsState.setCurrent(target.id);
      return;
    }
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
    const raw = (node.data as any)?.file as string | undefined;
    if (!raw) return;
    const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
    const clean = raw.replace(regex, '');
    editorState.open({
      id: nanoid(),
      path: clean,
      name: clean.split(/[\\/]/).pop() ?? clean,
    });
    const target = findByPath(fsState.tree, clean);
    if (target) fsState.setCurrent(target.id);
  };

  const onEnter: NodeMouseHandler = async (_, node) => {
    if (node.type === 'group') return;
    
    setHoverId(node.id);
    const raw = (node.data as any)?.file as string | undefined;
    const functionName = (node.data as any)?.label as string | undefined;
    if (!raw || !functionName) {
      setSnippet('');
      return;
    }
    const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
    const clean = raw.replace(regex, '');
    const cacheKey = `${clean}_${functionName}`;
    if (snippetCache.has(cacheKey)) {
      try {
        const txt = await fetch(`/api/file?path=${encodeURIComponent(clean)}`).then((r) => r.text());
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
      const txt = await fetch(`/api/file?path=${encodeURIComponent(clean)}`).then((r) => r.text());
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

  const onEdgeMouseEnter = useCallback((event: React.MouseEvent, edge: Edge) => {
    setHoveredEdgeId(edge.id);
  }, []);
  const onEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeId(null);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );

  useEffect(() => {
    if (!diagramReady) return;
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
          body: JSON.stringify({ path: `../../${TARGET_FOLDER}`, file_type: 'py' }),
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
  }, [diagramReady]);

  const finalNodes = nodes.map((n) => {
    const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
    const clean = ((n.data as any)?.file || '').replace(regex, '');
    const isActive = clean === activePath;
    const isHover = hoverId === n.id;
    const isSelected = selectedNodeId === n.id;
    const isGroup = n.type === 'group';
    const isCollapsed = isGroup && collapsedGroups.has(n.id);
    const isHidden = !isGroup && isNodeHidden(n.id, collapsedGroups, nodes);

    return {
      ...n,
      hidden: isHidden,
      style: {
        ...n.style,
        background: isGroup
          ? isCollapsed 
            ? '#f3f4f6'
            : isHover
              ? '#fef9c3'
              : isSelected
                ? '#fca5a5'
                : isActive
                  ? '#dbeafe'
                  : '#FAFAFA'
          : isHover
            ? '#fef9c3'
            : isSelected
              ? '#fca5a5'
              : isActive
                ? '#dbeafe'
                : '#ffffff',
        border: isGroup
          ? isCollapsed
            ? '2px solid #6b7280'
            : isHover
              ? '4px solid #eab308'
              : isActive
                ? '1px solid #fb923c'
                : '1px solid #b9bfc9'
          : isHover
            ? '4px solid #eab308'
            : isSelected
              ? '4px solid #b91c1c'
              : isActive
                ? '1px solid #0284c7'
                : '1px solid #4A90E2',
        transition: 'all 0.1s ease-in-out',
        // minWidth: isGroup ? (isCollapsed ? 200 : undefined) : n.style?.minWidth || 120, // Old line
        minWidth: isGroup ? (isCollapsed ? 200 : undefined) : (n.style?.width as number | undefined), // Use actual width as minWidth for function nodes
        width: isGroup && isCollapsed ? 200 : n.style?.width,
        height: isGroup && isCollapsed ? 50 : n.style?.height,
        cursor: isGroup && isCollapsed ? 'pointer' : 'default',
      },
      data: isGroup
        ? {
            ...n.data,
            isCollapsed,
            onToggleCollapse: () => onToggleCollapse(n.id),
          }
        : n.data,
    };
  });

  const finalEdges = edges.map((e) => {
    const sourceHidden = isNodeHidden(e.source, collapsedGroups, nodes);
    const targetHidden = isNodeHidden(e.target, collapsedGroups, nodes);
    
    const isHidden = sourceHidden || targetHidden;
    
    const isHover = hoveredEdgeId === e.id;
    return {
      ...e,
      hidden: isHidden,
      style: {
        ...(e.style || {}),
        stroke: isHover ? '#f59e42' : (e.style?.stroke ?? '#34A853'),
        strokeWidth: isHover ? 4 : (e.style?.strokeWidth ?? 2),
        transition: 'all 0.13s',
        cursor: 'pointer',
      },
      markerEnd: {
        ...(e.markerEnd || {}),
        color: isHover ? '#f59e42' : (e.markerEnd?.color ?? '#34A853'),
      },
      zIndex: 10000,
    };
  });

  const reLayout = useCallback(() => {
    if (diagramCache) {
      hydrate(diagramCache);
    }
  }, []);

  const handleGenerateCFG = async () => {
    setCfgMessage(null);
    setCfgLoading(true);
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

    // Prevent duplicate panel for the same file/function
    const alreadyExists = cfgPanels.some(
      p => p.file === file && p.functionName === functionName
    );
    if (alreadyExists) {
      setCfgMessage('이미 해당 함수의 CFG 패널이 열려 있습니다.');
      setCfgLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}${ENDPOINT_CFG}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: file,
          function_name: functionName,
        }),
      });
      const data = await res.json();
      if (data.status && data.status !== 200) {
        setCfgMessage('API 호출 실패: ' + (data.data || ''));
      } else {
        const cfgRaw = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        // 레이아웃이 필요한 경우 RawNode/RawEdge로 넘기고, 결과 좌표를 cfgNodes에 반영
        let cfgNodes = (cfgRaw.nodes || []).map((n: any) => ({
          id: n.id,
          data: { 
            label: n.label || n.id,
            file: n.file || file,
            line_start: n.line_start || 1,
            line_end: n.line_end || 1,
          },
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

        if (
          cfgRaw.nodes?.length > 0 &&
          cfgRaw.nodes.every((n: any) => (!n.x && !n.y))
        ) {
          const posMap = layoutWithCluster({ [file]: { nodes: cfgRaw.nodes, edges: cfgRaw.edges } }, {});
          cfgNodes = cfgNodes.map(n => ({
            ...n,
            position: posMap[n.id] ?? { x: 0, y: 0 }
          }));
        }

        console.log('CFG Panel nodes:', cfgNodes);
        console.log('CFG Panel edges:', cfgEdges);

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
            width: 800, // 초기 width 증가
            height: 600, // 초기 height 증가
          },
        ]);
        setCfgMessage(null);
      }
    } catch (e: any) {
      setCfgMessage('API 호출 중 오류가 발생했습니다. error: ' + e.message);
    } finally {
      setCfgLoading(false);
    }
  };

  const handleResizeStart = (panelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const panel = cfgPanels.find(p => p.id === panelId);
    const origWidth = panel?.width ?? 400;
    const origHeight = panel?.height ?? 320;

    setCfgPanels(panels =>
      panels.map(p =>
        p.id === panelId
          ? { ...p, resizing: true }
          : p
      )
    );

    const maxWidth = Math.min(window.innerWidth - 40, 800); // allow up to 1600px or window size
    const maxHeight = Math.min(window.innerHeight - 40, 600); // allow up to 1200px or window size

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setCfgPanels(panels =>
        panels.map(p =>
          p.id === panelId
            ? {
                ...p,
                width: Math.max(220, Math.min(origWidth + dx, maxWidth)),
                height: Math.max(120, Math.min(origHeight + dy, maxHeight)),
              }
            : p
        )
      );
    };

    const onMouseUp = () => {
      setCfgPanels(panels =>
        panels.map(p =>
          p.id === panelId
            ? { ...p, resizing: false }
            : p
        )
      );
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  if (!diagramReady) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <button
          onClick={() => setDiagramReady(true)}
          style={{
            minWidth: 180,
            padding: '12px 32px',
            borderRadius: 8,
            background: '#fff',
            color: '#3b3b4f',
            fontWeight: 600,
            fontSize: 18,
            border: '1.5px solid #d1d5db',
            boxShadow: '0 2px 8px #0001',
            outline: 'none',
            cursor: 'pointer',
            transition: 'background 0.13s, box-shadow 0.13s, border 0.13s, color 0.13s',
            letterSpacing: 0.5,
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = '#f3f4f6';
            e.currentTarget.style.border = '1.5px solid #6366f1';
            e.currentTarget.style.color = '#4338ca';
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = '#fff';
            e.currentTarget.style.border = '1.5px solid #d1d5db';
            e.currentTarget.style.color = '#3b3b4f';
          }}
        >
          <span style={{
            display: 'inline-block',
            marginRight: 8,
            verticalAlign: 'middle',
            fontSize: 18,
            color: '#6366f1',
            transition: 'color 0.13s',
          }}>▶</span>
          Generate Diagram
        </button>
      </div>
    );
  }

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

  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={finalNodes}
        edges={finalEdges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onEnter}
        onNodeMouseLeave={onLeave}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        fitView
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50"
        nodeTypes={{ group: CustomGroupNode }}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setCfgMessage(null); // 빈 공간 클릭 시 메시지 clear
        }}
      >
        <Background variant="dots" gap={16} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={n =>
            n.type === 'group'
              ? collapsedGroups.has(n.id) ? '#6b7280' : '#bdbdbd'
              : n.style?.background === '#fef9c3'
                ? '#facc15'
                : n.style?.background === '#dbeafe'
                  ? '#0284c7'
                  : '#2563eb'
          }
          nodeStrokeColor={n =>
            n.type === 'group'
              ? collapsedGroups.has(n.id) ? '#374151' : '#757575'
              : n.style?.border?.includes('#eab308')
                ? '#eab308'
                : n.style?.border?.includes('#0284c7')
                  ? '#0284c7'
                  : '#1e40af'
          }
          nodeStrokeWidth={2}
          maskColor="rgba(255,255,255,0.7)"
          style={{
            background: '#f3f4f6',
            border: '1.5px solid #cbd5e1',
            borderRadius: 6,
            boxShadow: '0 2px 8px #0002',
          }}
        />
        <Controls>
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: cfgLoading ? 0.3 : 1 }}>
              <circle cx="6" cy="6" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2" />
              <circle cx="14" cy="6" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2" />
              <circle cx="10" cy="14" r="2.2" fill="#000" fillOpacity="0.12" stroke="#222" strokeWidth="1.2" />
              <line x1="7.5" y1="7.5" x2="10" y2="12" stroke="#222" strokeWidth="1.2" />
              <line x1="12.5" y1="7.5" x2="10" y2="12" stroke="#222" strokeWidth="1.2" />
              <line x1="8.2" y1="6" x2="11.8" y2="6" stroke="#222" strokeWidth="1.2" />
              <g>
                <circle cx="16.5" cy="16.5" r="3.2" fill="#222" />
                <rect x="16" y="14.2" width="1" height="4.6" rx="0.5" fill="#fff" />
                <rect x="14.2" y="16" width="4.6" height="1" rx="0.5" fill="#fff" />
              </g>
            </svg>
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
            maxWidth: 1600,
            minHeight: panel.expanded ? 0 : 0,
            maxHeight: panel.expanded ? 1200 : 44,
            boxShadow: '0 2px 8px #0002',
            whiteSpace: 'pre-wrap',
            overflow: panel.expanded ? 'auto' : 'hidden',
            transition: 'all 0.2s cubic-bezier(.4,2,.6,1)',
            display: 'flex',
            flexDirection: 'column',
            cursor: panel.dragging ? 'move' : 'default',
            userSelect: panel.dragging ? 'none' : 'auto',
            pointerEvents: panel.dragging ? 'none' : 'auto',
            width: panel.width ?? 400,
            height: panel.expanded ? (panel.height ?? 320) : undefined,
            resize: 'none',
          }}
        >
          {/* ▼ CFG 패널 우측 상단 메시지 영역 */}
          {cfgPanelMessage && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 12,
                background: 'transparent',
                padding: 0,
                borderRadius: 5,
                zIndex: 300,
                fontSize: 13,
                fontWeight: 500,
                boxShadow: 'none',
                pointerEvents: 'none',
                maxWidth: 340,
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'normal',
              }}
              // 설명 메시지는 HTML로 렌더링
              dangerouslySetInnerHTML={{ __html: cfgPanelMessage }}
            />
          )}
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
              // Only start drag if not clicking on a button
              if (
                (e.target as HTMLElement).closest('button') ||
                (e.target as HTMLElement).tagName === 'BUTTON'
              ) {
                return;
              }
              // Start global drag for this panel
              const startX = e.clientX;
              const startY = e.clientY;
              const origX = panel.pos.x;
              const origY = panel.pos.y;
              let dragging = true;

              setCfgPanels(panels =>
                panels.map(p =>
                  p.id === panel.id
                    ? { ...p, dragging: true }
                    : p
                )
              );

              const onMouseMove = (moveEvent: MouseEvent) => {
                if (!dragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                
                // Calculate new position
                const newX = origX - dx;
                const newY = origY + dy;
                
                // Get panel dimensions
                const panelWidth = panel.width ?? 400;
                const panelHeight = panel.expanded ? (panel.height ?? 320) : 44;
                
                // Apply boundaries to keep panel on screen
                const minX = 20; // Minimum distance from right edge
                const maxX = window.innerWidth - panelWidth - 20; // Maximum distance from left edge
                const minY = 20; // Minimum distance from top
                const maxY = window.innerHeight - panelHeight - 20; // Maximum distance from bottom
                
                const boundedX = Math.max(minX, Math.min(newX, maxX));
                const boundedY = Math.max(minY, Math.min(newY, maxY));
                
                setCfgPanels(panels =>
                  panels.map(p =>
                    p.id === panel.id
                      ? {
                          ...p,
                          pos: {
                            x: boundedX,
                            y: boundedY,
                          },
                        }
                      : p
                  )
                );
              };

              const onMouseUp = () => {
                dragging = false;
                setCfgPanels(panels =>
                  panels.map(p =>
                    p.id === panel.id
                      ? { ...p, dragging: false }
                      : p
                  )
                );
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
              };

              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
              e.preventDefault();
            }}
          >
            <span style={{ flex: 1 }}>
                CFG ({panel.functionName}
                {panel.file && (
                  <> @ {panel.file.split(/[\\/]/).pop()}</>
                )}
              )
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
                <path d="M4 6l4 4 4-4" stroke="#888" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
            <div style={{ width: '100%', height: panel.height ?? 320, overflow: 'auto', position: 'relative' }}>
              {panel.result && panel.result.nodes && panel.result.edges ? (
                <div style={{ width: '100%', height: '100%', background: '#f8fafc', borderRadius: 6 }}>
                  <ReactFlow
                    nodes={panel.result.nodes}
                    edges={panel.result.edges}
                    fitView
                    minZoom={0.2}
                    maxZoom={2}
                    className="bg-gray-50"
                    style={{ width: '100%', height: '100%' }}
                    defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
                    // ▼ 노드 hover 시 label을 setCfgPanelMessage로 출력 + 설명 API 호출
                    onNodeMouseEnter={async (_, node) => {
                      const label = (node.data as any)?.label ?? node.id;
                      const file = (node.data as any)?.file;
                      const line_start = (node.data as any)?.line_start ?? undefined;
                      const line_end = (node.data as any)?.line_end ?? undefined;

                      // 1. 로딩 메시지 표시 (아인슈타인 아이콘 + 말풍선)
                      setCfgPanelMessage(
                        `<div style="display:flex;align-items:flex-start;gap:8px;">
                          <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
                          <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
                            설명을 불러오는 중입니다...
                          </span>
                        </div>`
                      );

                      try {
                        // 2. API 호출
                        const res = await fetch(`${apiUrl}${ENDPOINT_INLINE_CODE_EXPLANATION}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            file_path: file,
                            line_start,
                            line_end,
                          }),
                        });
                        console.log('Explain API response:', res);
                        const data = await res.json();
                        console.log('Explain API data:', data);
                        let explain = typeof data.explanation === 'string' ? data.explanation : (data.data?.explanation ?? '');
                        if (!explain) explain = '설명을 가져올 수 없습니다.';

                        // 3. 설명 메시지 표시 (아인슈타인 아이콘 + 말풍선)
                        setCfgPanelMessage(
                          `<div style="display:flex;align-items:flex-start;gap:8px;">
                            <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
                            <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:320px;display:inline-block;white-space;">
                              ${explain}
                            </span>
                          </div>`
                        );
                      } catch (e: any) {
                        setCfgPanelMessage(
                          `<div style="display:flex;align-items:flex-start;gap:8px;">
                            <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
                            <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
                              설명을 가져오는 중 오류가 발생했습니다.
                            </span>
                          </div>`
                        );
                      }

                      // 기존 코드: 파일 열기/탭 활성화
                      if (file) {
                        const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
                        const clean = file.replace(regex, '');
                        const tab = editorState.tabs.find(t => t.path === clean);
                        if (tab) {
                          editorState.setActive(tab.id, { from: line_start, to: line_end });
                        } else {
                          editorState.open({
                            id: nanoid(),
                            path: clean,
                            name: clean.split(/[\\/]/).pop() ?? clean,
                            line: line_start,
                            highlight: {from: line_start, to: line_end},
                          });
                        }
                        const target = findByPath(fsState.tree, clean);
                        if (target) fsState.setCurrent(target.id);
                      }
                    }}
                    onNodeMouseLeave={() => {
                      setCfgPanelMessage(null);
                    }}
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
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  right: 2,
                  bottom: 2,
                  width: 18,
                  height: 18,
                  cursor: 'nwse-resize',
                  zIndex: 10,
                  background: 'transparent',
                  display: panel.resizing === false ? 'block' : 'block',
                  userSelect: 'none',
                }}
                onMouseDown={e => handleResizeStart(panel.id, e)}
              >
                <svg width="18" height="18" style={{ pointerEvents: 'none' }}>
                  <polyline points="4,18 18,4" stroke="#888" strokeWidth="2" fill="none" />
                  <rect x="12" y="12" width="5" height="5" fill="#e5e7eb" stroke="#888" strokeWidth="1" />
                </svg>
              </div>
            </div>
          )}
        </div>
      ))}
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
            background: '#fafafa',
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
          dangerouslySetInnerHTML={{ __html: `<pre class="hljs">${snippet}</pre>` }}
        />
      )}
    </div>
  );

  /**
   * 다이어그램 데이터를 React Flow에 맞게 변환하고 배치
   * @param json 다이어그램 데이터
   */
  function hydrate(json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>) {
    const nodeSpecificWidths: Record<string, number> = {};
    const textHorizontalPaddingTotal = 16; // e.g., 8px left + 8px right for text inside node
    const minNodeWidth = 60; // Minimum width for a node
    const nodeFontSize = '12px';
    const nodeFontFamily = 'Arial, sans-serif';
    const nodeFont = `${nodeFontSize} ${nodeFontFamily}`;

    // Pre-calculate widths for all function nodes
    Object.values(json).forEach(data => {
      data.nodes.forEach(rawNode => {
        const label = rawNode.label || rawNode.function_name || rawNode.id;
        const estimatedTextWidth = getTextWidth(label, nodeFont);
        const calculatedWidth = Math.max(minNodeWidth, estimatedTextWidth + textHorizontalPaddingTotal);
        nodeSpecificWidths[rawNode.id] = calculatedWidth;
      });
    });

    let allFunctionNodes: Node[] = [];
    let allRawEdges: RawEdge[] = [];
    Object.entries(json).forEach(([file, data]) => {
      const { nodes: rawNodes, edges: rawEdges } = data;
      const fileFunctionNodes: Node[] = rawNodes.map((r) => {
        const label = r.label || r.function_name || r.id;
        const nodeWidth = nodeSpecificWidths[r.id];
        return {
          id: r.id,
          data: { label: label, file: r.file },
          position: { x: 0, y: 0 }, // Will be updated by layout
          style: {
            padding: '6px 8px', // Minimal vertical padding (6px top/bottom), 8px horizontal (left/right)
            borderRadius: 4,
            border: '1px solid #3b82f6',
            background: '#fff',
            width: nodeWidth, // Apply dynamic width
            fontSize: nodeFontSize, // Explicitly set font size
            fontFamily: nodeFontFamily, // Explicitly set font family
            // Height will be determined by content (text + vertical padding)
          },
          zIndex: 1, // Function nodes above groups
        };
      });
      allFunctionNodes = allFunctionNodes.concat(fileFunctionNodes);
      allRawEdges = allRawEdges.concat(rawEdges);
    });
    const allNodeIds = new Set(allFunctionNodes.map((n) => n.id));
    const allEdges: Edge[] = allRawEdges
      .filter((e) => allNodeIds.has(e.source) && allNodeIds.has(e.target))
      .map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: '#34A853',
        },
        animated: true,
        style: { stroke: '#34A853', strokeWidth: 2 },
        zIndex: 10000,
        type: 'step',
      }));

    // Pass the calculated widths to the layout function
    const posMap = layoutWithCluster(json, nodeSpecificWidths);

    const laidOutFunctionNodes = allFunctionNodes.map((n) => ({
      ...n,
      position: posMap[n.id] ?? { x: 0, y: 0 },
    }));

    const groupNodes: Node[] = [];
    const groupPadding = 20; // Increased padding for group node around its children
    const defaultNodeHeight = 30; // Approximate height for single-line text nodes (12px text + 2*6px vert padding + small buffer)

    const fileToNodes: Record<string, Node[]> = {};
    laidOutFunctionNodes.forEach((node) => {
      const file = (node.data as any).file;
      if (!fileToNodes[file]) fileToNodes[file] = [];
      fileToNodes[file].push(node);
    });

    Object.entries(fileToNodes).forEach(([file, nodesInGroup]) => {
      if (nodesInGroup.length === 0) return;
      const xs = nodesInGroup.map((n) => n.position.x);
      const ys = nodesInGroup.map((n) => n.position.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      
      const maxX = Math.max(...nodesInGroup.map(n => n.position.x + ((n.style?.width as number) || minNodeWidth)));
      // Assuming node height is relatively consistent or use defaultNodeHeight
      const maxY = Math.max(...nodesInGroup.map(n => n.position.y + ((n.style?.height as number) || defaultNodeHeight)));
      
      const groupId = `group-${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
      groupNodes.push({
        id: groupId,
        type: 'group',
        data: { 
          label: file.split('/').pop() || file,
          file: file
        },
        position: { x: minX - groupPadding, y: minY - groupPadding },
        style: {
          width: maxX - minX + 2 * groupPadding,
          height: maxY - minY + 2 * groupPadding,
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px dashed #fb923c',
          borderRadius: 8,
        },
        zIndex: 0, // Groups behind function nodes
      });
      nodesInGroup.forEach((node) => {
        node.position = {
          x: node.position.x - (minX - groupPadding),
          y: node.position.y - (minY - groupPadding),
        };
        node.parentId = groupId;
        node.extent = 'parent';
      });
    });
    const allNodes = [...groupNodes, ...laidOutFunctionNodes];
    setNodes(allNodes);
    setEdges(allEdges);
  }
}

/**
 * 파일 트리에서 경로로 노드 찾기
 * @param nodes 파일 노드 배열
 * @param p 찾을 경로
 * @returns 찾은 파일 노드
 */
function findByPath(nodes: FileNode[] = [], p: string): FileNode | undefined {
  const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
  for (const n of nodes) {
    if (n.path?.replace(regex, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}
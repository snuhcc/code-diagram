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
import { nanoid } from 'nanoid';
import { useEditor } from '@/store/editor';
import { useFS, type FileNode } from '@/store/files';
import {
  RawNode,
  RawEdge,
  CFGPanel,
  snippetCache,
  getTextWidth,
  extractFunctionSnippetWithLine,
  addLineNumbersAndHighlight,
  isNodeHidden,
  findRepresentativeGroup,
  getRedirectedEdge,
  layoutWithCluster,
  CustomGroupNode,
} from './diagramUtils';

// Constants
let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const ENDPOINT_CG = '/api/generate_call_graph';
const ENDPOINT_CFG = '/api/generate_control_flow_graph';
const ENDPOINT_INLINE_CODE_EXPLANATION = '/api/inline_code_explanation';
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER;

export default function DiagramViewer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cfgMessage, setCfgMessage] = useState<string | null>(null);
  const [cfgPanels, setCfgPanels] = useState<
    { id: string; functionName: string; file: string; result: any; expanded: boolean; pos: { x: number; y: number }; dragging: boolean; dragOffset: { x: number; y: number } }[]
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

  // Process edges to handle collapsed groups
  const processedEdges = edges.map((e) => {
    const sourceRepresentative = findRepresentativeGroup(e.source, collapsedGroups, nodes);
    const targetRepresentative = findRepresentativeGroup(e.target, collapsedGroups, nodes);
    
    const isRedirected = sourceRepresentative !== e.source || targetRepresentative !== e.target;
    
    if (sourceRepresentative === targetRepresentative && collapsedGroups.has(sourceRepresentative)) {
      return {
        ...e,
        hidden: true,
      };
    }
    
    const finalEdge = isRedirected ? {
      ...e,
      id: `${e.id}_redirected_${sourceRepresentative}_${targetRepresentative}`,
      source: sourceRepresentative,
      target: targetRepresentative,
      data: {
        ...e.data,
        originalSource: e.source,
        originalTarget: e.target,
        isRedirected: true,
      },
    } : e;
    
    const isHover = hoveredEdgeId === finalEdge.id;
    
    return {
      ...finalEdge,
      hidden: false,
      style: {
        ...(finalEdge.style || {}),
        stroke: isHover ? '#f59e42' : '#34A853',
        strokeWidth: isHover ? 4 : (isRedirected ? 3 : (finalEdge.style?.strokeWidth ?? 2)),
        strokeDasharray: isRedirected ? '5 5' : undefined,
        transition: 'all 0.13s',
        cursor: 'pointer',
      },
      markerEnd: {
        ...(finalEdge.markerEnd || {}),
        color: isHover ? '#f59e42' : '#34A853',
      },
      zIndex: isRedirected ? 10001 : 10000,
    };
  });

  // Remove duplicate edges and ensure unique keys
  const seenEdges = new Map<string, Edge>();
  processedEdges.forEach((edge) => {
    const key = `${edge.source}-${edge.target}`;
    const existingEdge = seenEdges.get(key);
    
    if (!existingEdge || edge.data?.isRedirected) {
      seenEdges.set(key, edge);
    }
  });
  
  const finalEdges = Array.from(seenEdges.values());

  // Create finalNodes
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
      type: isGroup ? 'group' : (n.type || 'default'),
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
        minWidth: isGroup ? (isCollapsed ? 200 : undefined) : (n.style?.width as number | undefined),
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

  const hydrate = (json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>) => {
    const nodeSpecificWidths: Record<string, number> = {};
    const textHorizontalPaddingTotal = 16;
    const minNodeWidth = 60;
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
          position: { x: 0, y: 0 },
          style: {
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid #3b82f6',
            background: '#fff',
            width: nodeWidth,
            fontSize: nodeFontSize,
            fontFamily: nodeFontFamily,
          },
          zIndex: 1,
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

    const posMap = layoutWithCluster(json, nodeSpecificWidths);

    const laidOutFunctionNodes = allFunctionNodes.map((n) => ({
      ...n,
      position: posMap[n.id] ?? { x: 0, y: 0 },
    }));

    const groupNodes: Node[] = [];
    const groupPadding = 20;
    const defaultNodeHeight = 30;

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
        zIndex: 0,
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

    // ▼ 모든 그룹을 collapse 상태로 초기화
    setCollapsedGroups(new Set(groupNodes.map(g => g.id)));
  };

  // --- Add: Expand/Collapse All Groups ---
  // Helper to get all group node ids
  const getAllGroupIds = () => nodes.filter(n => n.type === 'group').map(n => n.id);
  // Determine if all groups are collapsed
  const allGroupsCollapsed = (() => {
    const groupIds = getAllGroupIds();
    return groupIds.length > 0 && groupIds.every(id => collapsedGroups.has(id));
  })();
  // Handler for toggle all
  const handleToggleAllGroups = () => {
    const groupIds = getAllGroupIds();
    setCollapsedGroups(prev => {
      if (allGroupsCollapsed) {
        // Expand all
        const newSet = new Set(prev);
        groupIds.forEach(id => newSet.delete(id));
        return newSet;
      } else {
        // Collapse all
        return new Set(groupIds);
      }
    });
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
          {/* --- Expand/Collapse All Groups Toggle Button --- */}
          <button
            type="button"
            title={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            onClick={handleToggleAllGroups}
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
              position: 'relative',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
            }}
          >
            {allGroupsCollapsed ? (
              // Expand icon: Down arrow (like VSCode "chevron-down")
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <polyline points="7.5,4.5 12,9 7.5,13.5" stroke="#222" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              // Collapse icon: Right arrow (like VSCode "chevron-right")
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <polyline points="4.5,7.5 9,12 13.5,7.5" stroke="#222" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          {/* --- End Expand/Collapse All Groups Toggle Button --- */}
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
                            file_path: panel.file,
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
}

/**
 * 파일 트리에서 경로로 노드 찾기
 * @param nodes 파일 노드 배열
 * @param p 찾을 경로
 * @returns 찾은 파일 노드
 */
function findByPath(nodes: FileNode[] = [], p: string): FileNode | undefined {
  const regex = new RegExp(`^${process.env.NEXT_PUBLIC_TARGET_FOLDER}[\\\\/]`);
  for (const n of nodes) {
    if (n.path?.replace(regex, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}
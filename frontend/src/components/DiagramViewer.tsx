'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  extractFunctionSnippet,
  highlightWithLineNumbers,
  isNodeHidden,
  findRepresentativeNode,
  calculateLayout,
  CustomGroupNode,
  parseApiResponse,
  cleanFilePath,
  calculateNodeWidth,
  ENDPOINTS,
  STYLES,
} from './diagramUtils';

// Constants
let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER;

export default function DiagramViewer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
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
  const [cfgPanelMessage, setCfgPanelMessage] = useState<string | null>(null);

  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  const activePath = editorState.tabs.find(t => t.id === editorState.activeId)?.path ?? '';

  // Handlers
  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      newSet.has(groupId) ? newSet.delete(groupId) : newSet.add(groupId);
      return newSet;
    });
  }, []);

  const openFile = useCallback((filePath: string, line?: number, highlight?: { from: number; to: number }) => {
    const cleanPath = cleanFilePath(filePath, TARGET_FOLDER);
    editorState.open({
      id: nanoid(),
      path: cleanPath,
      name: cleanPath.split(/[\\/]/).pop() ?? cleanPath,
      line,
      highlight,
    });
    const target = findByPath(fsState.tree, cleanPath);
    if (target) fsState.setCurrent(target.id);
  }, [editorState, fsState]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (node.type === 'group') {
      const childNode = nodes.find(n => n.parentId === node.id && !isNodeHidden(n.id, collapsedGroups, nodes));
      const filePath = (childNode?.data as any)?.file || (node.data as any)?.file;
      if (filePath) openFile(filePath, 1);
      return;
    }
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
    const filePath = (node.data as any)?.file;
    if (filePath) openFile(filePath);
  }, [nodes, collapsedGroups, openFile]);

  const onNodeMouseEnter: NodeMouseHandler = useCallback(async (_, node) => {
    if (node.type === 'group') return;
    
    setHoverId(node.id);
    const filePath = (node.data as any)?.file;
    const functionName = (node.data as any)?.label;
    if (!filePath || !functionName) {
      setSnippet('');
      return;
    }

    const cleanPath = cleanFilePath(filePath, TARGET_FOLDER);
    const cacheKey = `${cleanPath}_${functionName}`;
    
    try {
      let code = snippetCache.get(cacheKey);
      if (!code) {
        const response = await fetch(`/api/file?path=${encodeURIComponent(cleanPath)}`);
        code = await response.text();
      }
      
      const result = extractFunctionSnippet(code, functionName);
      if (result) {
        snippetCache.set(cacheKey, result.snippet);
        setSnippet(highlightWithLineNumbers(result.snippet, result.startLine));
      } else {
        setSnippet('(function not found)');
      }
    } catch {
      setSnippet('(preview unavailable)');
    }
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoverId(null);
    setSnippet('');
  }, []);

  const handleCFGPanelUpdate = useCallback((id: string, updates: Partial<CFGPanel>) => {
    setCfgPanels(panels => panels.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const handleCFGPanelClose = useCallback((id: string) => {
    setCfgPanels(panels => panels.filter(p => p.id !== id));
  }, []);

  const handleCFGNodeHover = useCallback(async (node: Node | null, panel: CFGPanel) => {
    if (!node) {
      setCfgPanelMessage(null);
      return;
    }

    const { line_start, line_end } = node.data as any;
    
    setCfgPanelMessage(
      `<div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
        <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
          설명을 불러오는 중입니다...
        </span>
      </div>`
    );

    try {
      const res = await fetch(`${apiUrl}${ENDPOINTS.INLINE_CODE_EXPLANATION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: panel.file, line_start, line_end }),
      });
      const data = await res.json();
      const explanation = data.explanation || data.data?.explanation || '설명을 가져올 수 없습니다.';
      
      setCfgPanelMessage(
        `<div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
          <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:320px;display:inline-block;">
            ${explanation}
          </span>
        </div>`
      );
    } catch {
      setCfgPanelMessage(
        `<div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
          <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
            설명을 가져오는 중 오류가 발생했습니다.
          </span>
        </div>`
      );
    }

    openFile(node.data.file || panel.file, line_start, { from: line_start, to: line_end });
  }, [apiUrl, openFile]);

  const handleGenerateCFG = async () => {
    setCfgMessage(null);
    setCfgLoading(true);
    
    const selectedNode = nodes.find(n => n.id === selectedNodeId && n.type !== 'group');
    if (!selectedNode) {
      setCgPanelMessage('선택된 노드가 없습니다.');
      setCfgLoading(false);
      return;
    }
    
    const { file, label: functionName } = selectedNode.data as any;
    if (!file || !functionName) {
      setCgPanelMessage('노드 정보가 올바르지 않습니다.');
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
      const res = await fetch(`${apiUrl}${ENDPOINTS.CFG}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: file, function_name: functionName }),
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

      if (cfgData.nodes?.length > 0 && cfgData.nodes.every((n: any) => !n.x && !n.y)) {
        const posMap = calculateLayout({ [file]: { nodes: cfgData.nodes, edges: cfgData.edges } }, {});
        cfgNodes = cfgNodes.map((n: any) => ({
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
      setCgPanelMessage('API 호출 중 오류가 발생했습니다. error: ' + e.message);
    } finally {
      setCfgLoading(false);
    }
  }, [nodes, selectedNodeId, cfgPanels, apiUrl]);

  const hydrate = useCallback((json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>) => {
    const nodeWidths: Record<string, number> = {};
    const nodeFont = `${STYLES.NODE.FONT_SIZE} ${STYLES.NODE.FONT_FAMILY}`;

    // Calculate node widths
    Object.values(json).forEach(data => {
      data.nodes.forEach(node => {
        const label = node.label || node.function_name || node.id;
        nodeWidths[node.id] = calculateNodeWidth(label);
      });
    });

    // Create nodes
    let allFunctionNodes: Node[] = [];
    let allRawEdges: RawEdge[] = [];
    
    Object.entries(json).forEach(([file, data]) => {
      const functionNodes = data.nodes.map(n => ({
        id: n.id,
        data: { label: n.label || n.function_name || n.id, file: n.file },
        position: { x: 0, y: 0 },
        style: {
          padding: '6px 8px',
          borderRadius: 4,
          border: '1px solid #3b82f6',
          background: '#fff',
          width: nodeWidths[n.id],
          fontSize: STYLES.NODE.FONT_SIZE,
          fontFamily: STYLES.NODE.FONT_FAMILY,
        },
        zIndex: 1,
      }));
      allFunctionNodes = allFunctionNodes.concat(functionNodes);
      allRawEdges = allRawEdges.concat(data.edges);
    });

    // Create edges
    const nodeIds = new Set(allFunctionNodes.map(n => n.id));
    const allEdges: Edge[] = allRawEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: STYLES.COLORS.EDGE.DEFAULT,
        },
        animated: true,
        style: { stroke: STYLES.COLORS.EDGE.DEFAULT, strokeWidth: 2 },
        zIndex: 10000,
        type: 'step',
      }));

    // Calculate layout
    const posMap = calculateLayout(json, nodeWidths);
    const laidOutNodes = allFunctionNodes.map(n => ({
      ...n,
      position: posMap[n.id] ?? { x: 0, y: 0 },
    }));

    // Create groups
    const groupNodes: Node[] = [];
    const fileToNodes: Record<string, Node[]> = {};
    
    laidOutNodes.forEach(node => {
      const file = (node.data as any).file;
      if (!fileToNodes[file]) fileToNodes[file] = [];
      fileToNodes[file].push(node);
    });

    Object.entries(fileToNodes).forEach(([file, nodesInGroup]) => {
      if (nodesInGroup.length === 0) return;
      
      const xs = nodesInGroup.map(n => n.position.x);
      const ys = nodesInGroup.map(n => n.position.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...nodesInGroup.map(n => n.position.x + ((n.style?.width as number) || STYLES.NODE.MIN_WIDTH)));
      const maxY = Math.max(...nodesInGroup.map(n => n.position.y + ((n.style?.height as number) || STYLES.NODE.HEIGHT.DEFAULT)));
      
      const groupId = `group-${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
      groupNodes.push({
        id: groupId,
        type: 'group',
        data: { 
          label: file.split('/').pop() || file,
          file: file
        },
        position: { x: minX - STYLES.GROUP.PADDING, y: minY - STYLES.GROUP.PADDING },
        style: {
          width: maxX - minX + 2 * STYLES.GROUP.PADDING,
          height: maxY - minY + 2 * STYLES.GROUP.PADDING,
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px dashed #fb923c',
          borderRadius: 8,
        },
        zIndex: 0,
      });
      
      nodesInGroup.forEach(node => {
        node.position = {
          x: node.position.x - (minX - STYLES.GROUP.PADDING),
          y: node.position.y - (minY - STYLES.GROUP.PADDING),
        };
        node.parentId = groupId;
        node.extent = 'parent';
      });
    });

    setNodes([...groupNodes, ...laidOutNodes]);
    setEdges(allEdges);
  };

  if (!diagramReady) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <button
          onClick={() => setDiagramReady(true)}
          className="min-w-[180px] px-8 py-3 rounded-lg bg-white text-gray-700 font-semibold text-lg border border-gray-300 shadow-sm hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-700 transition-all"
        >
          <span className="inline-block mr-2 text-indigo-500">▶</span>
          Generate Diagram
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span className="ml-3 text-sm text-slate-500">diagram loading…</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>;
  }

  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={finalNodes}
        edges={processedEdges}
        onNodesChange={(changes) => setNodes(nds => applyNodeChanges(changes, nds))}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
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
          nodeColor={n => {
            if (n.type === 'group') return collapsedGroups.has(n.id) ? '#6b7280' : '#bdbdbd';
            const bg = n.style?.background;
            return bg === STYLES.COLORS.NODE.HOVER ? '#facc15' :
                   bg === STYLES.COLORS.NODE.ACTIVE ? '#0284c7' : '#2563eb';
          }}
          nodeStrokeColor={n => {
            if (n.type === 'group') return collapsedGroups.has(n.id) ? '#374151' : '#757575';
            const border = n.style?.border;
            return border?.includes(STYLES.COLORS.NODE.BORDER_HOVER) ? STYLES.COLORS.NODE.BORDER_HOVER :
                   border?.includes(STYLES.COLORS.NODE.BORDER_ACTIVE) ? STYLES.COLORS.NODE.BORDER_ACTIVE : '#1e40af';
          }}
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
            onClick={() => diagramCache && hydrate(diagramCache)}
            className="w-5 h-5 bg-white p-0 m-1 cursor-pointer flex items-center justify-center shadow-sm hover:shadow-md transition-shadow"
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
            className="w-5 h-5 bg-white p-0 m-1 cursor-pointer flex items-center justify-center shadow-sm hover:shadow-md transition-shadow relative disabled:cursor-not-allowed"
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
              <span className="absolute inset-0 flex items-center justify-center bg-white/70 rounded">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" stroke="#0284c7" strokeWidth="2" fill="none" strokeDasharray="28" strokeDashoffset="10" />
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
        <CFGPanelComponent
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

// Helper function
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
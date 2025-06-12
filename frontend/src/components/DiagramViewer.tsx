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
  const [cfgPanels, setCfgPanels] = useState<CFGPanel[]>([]);
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

  const handleGenerateCFG = useCallback(async () => {
    setCfgMessage(null);
    setCfgLoading(true);
    
    const selectedNode = nodes.find(n => n.id === selectedNodeId && n.type !== 'group');
    if (!selectedNode) {
      setCfgMessage('선택된 노드가 없습니다.');
      setCfgLoading(false);
      return;
    }
    
    const { file, label: functionName } = selectedNode.data as any;
    if (!file || !functionName) {
      setCfgMessage('노드 정보가 올바르지 않습니다.');
      setCfgLoading(false);
      return;
    }

    if (cfgPanels.some(p => p.file === file && p.functionName === functionName)) {
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
        return;
      }
      
      const cfgData = parseApiResponse(data);
      let cfgNodes = (cfgData.nodes || []).map((n: any) => ({
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
      
      const cfgEdges = (cfgData.edges || []).map((e: any) => ({
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

      setCfgPanels(panels => [
        ...panels,
        {
          id: `${file}__${functionName}__${Date.now()}`,
          functionName,
          file,
          result: { nodes: cfgNodes, edges: cfgEdges },
          expanded: true,
          pos: { x: 24 + panels.length * 32, y: 24 + panels.length * 32 },
          dragging: false,
          dragOffset: { x: 0, y: 0 },
          width: STYLES.CFG_PANEL.WIDTH,
          height: STYLES.CFG_PANEL.HEIGHT,
        },
      ]);
      setCfgMessage(null);
    } catch (e: any) {
      setCfgMessage('API 호출 중 오류가 발생했습니다. error: ' + e.message);
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
        type: 'smoothstep', // 곡선 엣지로 변경
      }));

    // Calculate layout
    const posMap = calculateLayout(json, nodeWidths);
    const laidOutNodes = allFunctionNodes.map(n => ({
      ...n,
      position: posMap[n.id] ?? { x: 0, y: 0 },
    }));

    // Create groups with overlap prevention
    const groupNodes: Node[] = [];
    const fileToNodes: Record<string, Node[]> = {};
    const groupBounds: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> = {};
    
    // Group nodes by file
    laidOutNodes.forEach(node => {
      const file = (node.data as any).file;
      if (!fileToNodes[file]) fileToNodes[file] = [];
      fileToNodes[file].push(node);
    });

    // Calculate initial bounds for each group
    Object.entries(fileToNodes).forEach(([file, nodesInGroup]) => {
      if (nodesInGroup.length === 0) return;
      
      const xs = nodesInGroup.map(n => n.position.x);
      const ys = nodesInGroup.map(n => n.position.y);
      const widths = nodesInGroup.map(n => (n.style?.width as number) || STYLES.NODE.MIN_WIDTH);
      const heights = nodesInGroup.map(n => (n.style?.height as number) || STYLES.NODE.HEIGHT.DEFAULT);
      
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
      const maxY = Math.max(...ys.map((y, i) => y + heights[i]));
      
      groupBounds[file] = { minX, minY, maxX, maxY };
    });

    // Detect and resolve overlaps between groups
    const files = Object.keys(groupBounds);
    const groupPadding = STYLES.GROUP.PADDING;
    const minGroupSpacing = 40; // 그룹 간 최소 간격
    
    // Multiple passes to resolve overlaps
    for (let pass = 0; pass < 5; pass++) {
      let hasOverlap = false;
      
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const bounds1 = groupBounds[files[i]];
          const bounds2 = groupBounds[files[j]];
          
          // Check for overlap with padding
          const overlap = {
            x: Math.max(0, Math.min(
              bounds1.maxX + groupPadding + minGroupSpacing - (bounds2.minX - groupPadding),
              bounds2.maxX + groupPadding + minGroupSpacing - (bounds1.minX - groupPadding)
            )),
            y: Math.max(0, Math.min(
              bounds1.maxY + groupPadding + minGroupSpacing - (bounds2.minY - groupPadding),
              bounds2.maxY + groupPadding + minGroupSpacing - (bounds1.minY - groupPadding)
            ))
          };
          
          // If overlap exists, move groups apart
          if (overlap.x > 0 && overlap.y > 0) {
            hasOverlap = true;
            
            // Calculate push direction based on centers
            const center1 = {
              x: (bounds1.minX + bounds1.maxX) / 2,
              y: (bounds1.minY + bounds1.maxY) / 2
            };
            const center2 = {
              x: (bounds2.minX + bounds2.maxX) / 2,
              y: (bounds2.minY + bounds2.maxY) / 2
            };
            
            const dx = center2.x - center1.x;
            const dy = center2.y - center1.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            
            // Determine push direction and amount
            const pushX = (dx / distance) * overlap.x * 0.6;
            const pushY = (dy / distance) * overlap.y * 0.6;
            
            // Move groups apart
            const nodesInGroup1 = fileToNodes[files[i]];
            const nodesInGroup2 = fileToNodes[files[j]];
            
            nodesInGroup1.forEach(node => {
              node.position.x -= pushX;
              node.position.y -= pushY;
            });
            
            nodesInGroup2.forEach(node => {
              node.position.x += pushX;
              node.position.y += pushY;
            });
            
            // Update bounds
            groupBounds[files[i]] = {
              minX: bounds1.minX - pushX,
              minY: bounds1.minY - pushY,
              maxX: bounds1.maxX - pushX,
              maxY: bounds1.maxY - pushY
            };
            
            groupBounds[files[j]] = {
              minX: bounds2.minX + pushX,
              minY: bounds2.minY + pushY,
              maxX: bounds2.maxX + pushX,
              maxY: bounds2.maxY + pushY
            };
          }
        }
      }
      
      if (!hasOverlap) break;
    }

    // Create group nodes with adjusted positions
    Object.entries(fileToNodes).forEach(([file, nodesInGroup]) => {
      if (nodesInGroup.length === 0) return;
      
      const bounds = groupBounds[file];
      const groupId = `group-${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      groupNodes.push({
        id: groupId,
        type: 'group',
        data: { 
          label: file.split('/').pop() || file,
          file: file
        },
        position: { 
          x: bounds.minX - groupPadding, 
          y: bounds.minY - groupPadding 
        },
        style: {
          width: bounds.maxX - bounds.minX + 2 * groupPadding,
          height: bounds.maxY - bounds.minY + 2 * groupPadding,
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px dashed #fb923c',
          borderRadius: 8,
        },
        zIndex: 0,
      });
      
      // Update node positions to be relative to group
      nodesInGroup.forEach(node => {
        node.position = {
          x: node.position.x - (bounds.minX - groupPadding),
          y: node.position.y - (bounds.minY - groupPadding),
        };
        node.parentId = groupId;
        node.extent = 'parent';
      });
    });

    setNodes([...groupNodes, ...laidOutNodes]);
    setEdges(allEdges);

    // ▼ 모든 그룹을 collapse 상태로 초기화
    setCollapsedGroups(new Set(groupNodes.map(g => g.id)));
  }, []);

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

  // Load diagram
  useEffect(() => {
    if (!diagramReady) return;
    
    (async () => {
      if (diagramCache) {
        hydrate(diagramCache);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(undefined);
      
      try {
        const res = await fetch(`${apiUrl}${ENDPOINTS.CG}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `../../${TARGET_FOLDER}`, file_type: 'py' }),
        });
        
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        
        const data = await res.json();
        const json = parseApiResponse(data);
        diagramCache = json;
        hydrate(json);
      } catch (e: any) {
        setError(String(e));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [diagramReady, apiUrl, hydrate]);

  // Process edges for collapsed groups
  const processedEdges = useMemo(() => {
    const processed = edges.map(e => {
      const sourceRep = findRepresentativeNode(e.source, collapsedGroups, nodes);
      const targetRep = findRepresentativeNode(e.target, collapsedGroups, nodes);
      
      if (sourceRep === targetRep && collapsedGroups.has(sourceRep)) {
        return { ...e, hidden: true };
      }
      
      const isRedirected = sourceRep !== e.source || targetRep !== e.target;
      const finalEdge = isRedirected ? {
        ...e,
        id: `${e.id}_redirected_${sourceRep}_${targetRep}`,
        source: sourceRep,
        target: targetRep,
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
          stroke: isHover ? STYLES.COLORS.EDGE.HOVER : STYLES.COLORS.EDGE.DEFAULT,
          strokeWidth: isHover ? 4 : (isRedirected ? 3 : 2),
          strokeDasharray: isRedirected ? '5 5' : undefined,
          transition: 'all 0.13s',
          cursor: 'pointer',
        },
        markerEnd: {
          ...(finalEdge.markerEnd || {}),
          color: isHover ? STYLES.COLORS.EDGE.HOVER : STYLES.COLORS.EDGE.DEFAULT,
        },
        zIndex: isRedirected ? 10001 : 10000,
      };
    });

    // Remove duplicates
    const seen = new Map<string, Edge>();
    processed.forEach(edge => {
      const key = `${edge.source}-${edge.target}`;
      if (!seen.has(key) || edge.data?.isRedirected) {
        seen.set(key, edge);
      }
    });
    
    return Array.from(seen.values());
  }, [edges, collapsedGroups, nodes, hoveredEdgeId]);

  // Process nodes for styling
  const finalNodes = useMemo(() => {
    return nodes.map(n => {
      const cleanPath = cleanFilePath((n.data as any)?.file || '', TARGET_FOLDER);
      const isActive = cleanPath === activePath;
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
              ? STYLES.COLORS.GROUP.COLLAPSED
              : isHover
                ? STYLES.COLORS.NODE.HOVER
                : isSelected
                  ? STYLES.COLORS.NODE.SELECTED
                  : isActive
                    ? STYLES.COLORS.NODE.ACTIVE
                    : STYLES.COLORS.GROUP.DEFAULT
            : isHover
              ? STYLES.COLORS.NODE.HOVER
              : isSelected
                ? STYLES.COLORS.NODE.SELECTED
                : isActive
                  ? STYLES.COLORS.NODE.ACTIVE
                  : STYLES.COLORS.NODE.DEFAULT,
          border: isGroup
            ? isCollapsed
              ? `2px solid ${STYLES.COLORS.GROUP.BORDER_COLLAPSED}`
              : isHover
                ? `4px solid ${STYLES.COLORS.NODE.BORDER_HOVER}`
                : isActive
                  ? `1px solid ${STYLES.COLORS.GROUP.BORDER_ACTIVE}`
                  : `1px solid ${STYLES.COLORS.GROUP.BORDER}`
            : isHover
              ? `4px solid ${STYLES.COLORS.NODE.BORDER_HOVER}`
              : isSelected
                ? `4px solid ${STYLES.COLORS.NODE.BORDER_SELECTED}`
                : isActive
                  ? `1px solid ${STYLES.COLORS.NODE.BORDER_ACTIVE}`
                  : `1px solid ${STYLES.COLORS.NODE.BORDER}`,
          transition: 'all 0.1s ease-in-out',
          minWidth: isGroup ? (isCollapsed ? STYLES.GROUP.COLLAPSED_WIDTH : undefined) : (n.style?.width as number),
          width: isGroup && isCollapsed ? STYLES.GROUP.COLLAPSED_WIDTH : n.style?.width,
          height: isGroup && isCollapsed ? STYLES.GROUP.COLLAPSED_HEIGHT : n.style?.height,
          cursor: isGroup && isCollapsed ? 'pointer' : 'default',
        },
        data: isGroup
          ? {
              ...n.data,
              isCollapsed,
              onToggleCollapse: () => toggleCollapse(n.id),
            }
          : n.data,
      };
    });
  }, [nodes, activePath, hoverId, selectedNodeId, collapsedGroups, toggleCollapse]);

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
          setCfgMessage(null);
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
        <div className="absolute top-[60px] right-6 bg-red-100 text-red-800 px-4 py-2 rounded-md z-[100] text-sm shadow-md">
          {cfgMessage}
        </div>
      )}
      
      {cfgPanels.map((panel, idx) => (
        <CFGPanelComponent
          key={panel.id}
          panel={panel}
          index={idx}
          onUpdate={handleCFGPanelUpdate}
          onClose={handleCFGPanelClose}
          onNodeHover={handleCFGNodeHover}
          message={cfgPanelMessage}
        />
      ))}
      
      {hoverId && snippet && (
        <div
          className="fixed z-50 top-4 right-4 min-w-[320px] max-w-[40vw] min-h-[40px] max-h-[80vh] bg-gray-50 text-slate-800 text-xs rounded-lg shadow-lg p-4 overflow-auto font-mono pointer-events-none"
          dangerouslySetInnerHTML={{ __html: `<pre class="hljs">${snippet}</pre>` }}
        />
      )}
    </div>
  );
}

// CFG Panel Component
function CFGPanelComponent({
  panel,
  index,
  onUpdate,
  onClose,
  onNodeHover,
  message,
}: {
  panel: CFGPanel;
  index: number;
  onUpdate: (id: string, updates: Partial<CFGPanel>) => void;
  onClose: (id: string) => void;
  onNodeHover: (node: Node | null, panel: CFGPanel) => void;
  message?: string | null;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = panel.pos.x;
    const origY = panel.pos.y;
    
    setIsDragging(true);
    onUpdate(panel.id, { dragging: true });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      const newX = origX - dx;
      const newY = origY + dy;
      
      const panelWidth = panel.width ?? STYLES.CFG_PANEL.WIDTH;
      const panelHeight = panel.expanded ? (panel.height ?? STYLES.CFG_PANEL.HEIGHT) : 44;
      
      const boundedX = Math.max(20, Math.min(newX, window.innerWidth - panelWidth - 20));
      const boundedY = Math.max(20, Math.min(newY, window.innerHeight - panelHeight - 20));
      
      onUpdate(panel.id, { pos: { x: boundedX, y: boundedY } });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      onUpdate(panel.id, { dragging: false });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  }, [panel, onUpdate]);

  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = panel.width ?? STYLES.CFG_PANEL.WIDTH;
    const startHeight = panel.height ?? STYLES.CFG_PANEL.HEIGHT;

    onUpdate(panel.id, { resizing: true });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      const newWidth = Math.max(300, Math.min(1600, startWidth + dx));
      const newHeight = Math.max(200, Math.min(1200, startHeight + dy));
      
      onUpdate(panel.id, { width: newWidth, height: newHeight });
    };

    const onMouseUp = () => {
      onUpdate(panel.id, { resizing: false });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [panel, onUpdate]);

  return (
    <div
      style={{
        position: 'fixed',
        top: panel.pos.y,
        right: panel.pos.x,
        background: '#f1f5f9',
        color: '#222',
        padding: panel.expanded ? '12px 18px 18px 18px' : '8px 18px',
        borderRadius: 8,
        zIndex: 200 + index,
        fontSize: 13,
        minWidth: 220,
        maxWidth: 1600,
        maxHeight: panel.expanded ? 1200 : 44,
        boxShadow: '0 2px 8px #0002',
        overflow: panel.expanded ? 'auto' : 'hidden',
        transition: 'all 0.2s cubic-bezier(.4,2,.6,1)',
        display: 'flex',
        flexDirection: 'column',
        cursor: isDragging ? 'move' : 'default',
        userSelect: isDragging ? 'none' : 'auto',
        width: panel.width ?? STYLES.CFG_PANEL.WIDTH,
        height: panel.expanded ? (panel.height ?? STYLES.CFG_PANEL.HEIGHT) : undefined,
      }}
    >
      {message && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            zIndex: 300,
            fontSize: 13,
            fontWeight: 500,
            pointerEvents: 'none',
            maxWidth: 340,
          }}
          dangerouslySetInnerHTML={{ __html: message }}
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
        onMouseDown={handleMouseDown}
      >
        <span style={{ flex: 1 }}>
          CFG ({panel.functionName}
          {panel.file && <> @ {panel.file.split(/[\\/]/).pop()}</>})
        </span>
        <button
          onClick={e => {
            e.stopPropagation();
            onUpdate(panel.id, { expanded: !panel.expanded });
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            padding: 0,
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s',
            transform: panel.expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
          aria-label={panel.expanded ? 'Collapse' : 'Expand'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={e => {
            e.stopPropagation();
            onClose(panel.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            padding: 0,
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      
      {panel.expanded && (
        <div style={{ width: '100%', height: panel.height ?? STYLES.CFG_PANEL.HEIGHT, overflow: 'auto', position: 'relative' }}>
          {panel.result?.nodes && panel.result?.edges ? (
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
                onNodeMouseEnter={(_, node) => onNodeHover(node, panel)}
                onNodeMouseLeave={() => onNodeHover(null, panel)}
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
          
          <div
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              zIndex: 10,
              userSelect: 'none',
            }}
            onMouseDown={handleResize}
          >
            <svg width="18" height="18" style={{ pointerEvents: 'none' }}>
              <polyline points="4,18 18,4" stroke="#888" strokeWidth="2" fill="none" />
              <rect x="12" y="12" width="5" height="5" fill="#e5e7eb" stroke="#888" strokeWidth="1" />
            </svg>
          </div>
        </div>
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
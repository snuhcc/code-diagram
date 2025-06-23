'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  applyNodeChanges,
  NodeChange,
  useReactFlow,
  useStore,
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
  extractCodeSnippet,
  highlightWithLineNumbers,
  isNodeHidden,
  findRepresentativeNode,
  calculateLayout,
  calculateLayoutWithClasses,
  CustomGroupNode,
  CustomNode,
  parseApiResponse,
  cleanFilePath,
  calculateNodeWidth,
  ENDPOINTS,
  STYLES,
  LAYOUT_RULES,
  calculateCFGLayout, // 추가
} from './diagramUtils';
import { getApiUrl, getTargetFolder } from '@/utils/config';
import type { CSSProperties } from 'react';

// Constants
let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const apiUrl = getApiUrl();
const TARGET_FOLDER = getTargetFolder();

export default function DiagramViewer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSnippet, setSelectedSnippet] = useState<string>(''); // 선택된 노드의 snippet
  const [cfgMessage, setCfgMessage] = useState<string | null>(null);
  const [cfgPanels, setCfgPanels] = useState<CFGPanel[]>([]);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [diagramReady, setDiagramReady] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [cfgPanelMessage, setCfgPanelMessage] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [currentStreamController, setCurrentStreamController] = useState<AbortController | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set()); // 빈 Set으로 시작
  const [fadeOpacity, setFadeOpacity] = useState(60); // 음영 처리 투명도 (0-100)

  // 최신 nodes를 참조하기 위한 ref (toggleCollapse가 안정적이게 유지)
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // 전역에서 하이라이트 노드를 업데이트할 수 있도록 함수 노출
  useEffect(() => {
    (window as any).updateHighlightedNodes = (nodeIds: string[], opacity: number = 60) => {
      console.log('[DV] Updating highlighted nodes:', nodeIds, 'Opacity:', opacity);
      setHighlightedNodeIds(new Set(nodeIds));
      setFadeOpacity(opacity);
      
      // 하이라이트된 노드들의 부모 그룹이 collapsed 상태면 expand
      if (nodeIds.length > 0) {
        const groupsToExpand = new Set<string>();
        
        nodeIds.forEach(nodeId => {
          const node = nodes.find(n => n.id === nodeId);
          if (node && node.parentId) {
            groupsToExpand.add(node.parentId);
          }
        });
        
        if (groupsToExpand.size > 0) {
          setCollapsedGroups(prev => {
            const newSet = new Set(prev);
            groupsToExpand.forEach(groupId => newSet.delete(groupId));
            return newSet;
          });
        }
      }
    };
    
    return () => {
      delete (window as any).updateHighlightedNodes;
    };
  }, [nodes]);

  // Cleanup streaming on unmount
  useEffect(() => {
    return () => {
      if (currentStreamController) {
        currentStreamController.abort();
      }
    };
  }, [currentStreamController]);

  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  const activePath = editorState.tabs.find(t => t.id === editorState.activeId)?.path ?? '';

  // Handlers
  // 그룹 노드 토글: 펼칠 때 하위 그룹은 모두 접힌 상태로 유지
  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      const isCurrentlyCollapsed = newSet.has(groupId);

      if (isCurrentlyCollapsed) {
        // --- Expand ---
        newSet.delete(groupId);

        // collapse all descendant groups
        nodesRef.current.forEach(n => {
          if (n.type !== 'group') return;
          let curParent = n.parentId;
          while (curParent) {
            if (curParent === groupId) {
              newSet.add(n.id);
              break;
            }
            const parent = nodesRef.current.find(p => p.id === curParent);
            curParent = parent?.parentId;
          }
        });
      } else {
        // --- Collapse ---
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  const openFile = useCallback((filePath: string, line?: number, highlight?: { from: number; to: number }) => {
    const cleanPath = cleanFilePath(filePath, TARGET_FOLDER);
    console.log('[DV] Opening file:', cleanPath, 'at line:', line, 'with highlight:', highlight);
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

  // 단일 클릭: 노드 선택만
  const onNodeClick: NodeMouseHandler = useCallback(async (_, node) => {
    if (node.type === 'group') {
      // 그룹 노드의 경우: 하이라이트 체크만
      const hasHighlightedChild = nodes.some(childNode => 
        childNode.parentId === node.id && highlightedNodeIds.has(childNode.id)
      );
      const shouldFadeGroup = highlightedNodeIds.size > 0 && !hasHighlightedChild;
      if (shouldFadeGroup) return;
      
      // 그룹 노드는 선택하지 않음
      return;
    }
    
    // 일반 노드의 경우: 음영 처리된 노드는 클릭 이벤트 무시
    const isNodeHighlighted = highlightedNodeIds.has(node.id);
    const shouldFadeNode = highlightedNodeIds.size > 0 && !isNodeHighlighted;
    if (shouldFadeNode) return;
    
    // 선택 처리
    const newSelectedId = selectedNodeId === node.id ? null : node.id;
    setSelectedNodeId(newSelectedId);
    
    // 선택된 노드의 snippet 가져오기
    if (newSelectedId) {
      const filePath = (node.data as any)?.file;
      const functionName = (node.data as any)?.originalName || (node.data as any)?.label;
      const lineStart = (node.data as any)?.line_start;
      
      if (filePath && functionName) {
        const cleanPath = cleanFilePath(filePath, TARGET_FOLDER);
        
        // 현재 에디터에 같은 파일이 열려있고, 같은 라인 영역이 표시되고 있는지 확인
        const editorState = useEditor.getState();
        const currentActivePath = editorState.tabs.find(t => t.id === editorState.activeId)?.path ?? '';
        const currentLine = editorState.line;
        
        const isFileCurrentlyOpen = currentActivePath && 
          cleanFilePath(currentActivePath, TARGET_FOLDER) === cleanPath;
        
        // 같은 파일이 열려있고, 라인 정보가 있으며, 현재 표시된 라인과 유사한 범위라면
        if (isFileCurrentlyOpen && lineStart && currentLine && 
            Math.abs(currentLine - lineStart) <= 5) { // 5줄 이내 차이면 같은 영역으로 간주
          setSelectedSnippet('(code is already open in the editor)');
        } else {
          const cacheKey = `${cleanPath}_${functionName}`;
          
          try {
            let code = snippetCache.get(cacheKey);
            if (!code) {
              const response = await fetch(`/api/file?path=${encodeURIComponent(cleanPath)}`);
              code = await response.text();
            }
            
            const result = extractCodeSnippet(code, functionName);
            if (result) {
              snippetCache.set(cacheKey, result.snippet);
              setSelectedSnippet(highlightWithLineNumbers(result.snippet, result.startLine));
            } else if (functionName.includes('.main')) {
              // script파일의 'main' 함수의 경우 특별 처리
              setSelectedSnippet(highlightWithLineNumbers(code, 1));
            } else {
              setSelectedSnippet('(code definition not found)');
            }
          } catch {
            setSelectedSnippet('(preview unavailable)');
          }
        }
      } else {
        setSelectedSnippet('');
      }
    } else {
      setSelectedSnippet('');
    }
  }, [nodes, highlightedNodeIds, selectedNodeId]);

  // 더블 클릭: 파일 열기
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    if (node.type === 'group') {
      // 그룹 노드의 경우: 자식 노드 중 하이라이트된 노드가 있는지 확인
      const hasHighlightedChild = nodes.some(childNode => 
        childNode.parentId === node.id && highlightedNodeIds.has(childNode.id)
      );
      const shouldFadeGroup = highlightedNodeIds.size > 0 && !hasHighlightedChild;
      if (shouldFadeGroup) return;
      
      const childNode = nodes.find(n => n.parentId === node.id && !isNodeHidden(n.id, collapsedGroups, nodes));
      const filePath = (childNode?.data as any)?.file || (node.data as any)?.file;
      if (filePath) openFile(filePath, 1);
      return;
    }
    
    // 일반 노드의 경우: 음영 처리된 노드는 클릭 이벤트 무시
    const isNodeHighlighted = highlightedNodeIds.has(node.id);
    const shouldFadeNode = highlightedNodeIds.size > 0 && !isNodeHighlighted;
    if (shouldFadeNode) return;
    
    const filePath = (node.data as any)?.file;
    const lineStart = (node.data as any)?.line_start;
    if (filePath) {
      // If we have line_start information, scroll to that line
      if (lineStart && lineStart > 0) {
        openFile(filePath, lineStart);
      } else {
        openFile(filePath);
      }
    }
  }, [nodes, collapsedGroups, openFile, highlightedNodeIds]);

  const onNodeMouseEnter: NodeMouseHandler = useCallback(async (_, node) => {
    if (node.type === 'group') return;
    
    // 음영 처리된 노드는 호버 이벤트 무시
    const isNodeHighlighted = highlightedNodeIds.has(node.id);
    const shouldFadeNode = highlightedNodeIds.size > 0 && !isNodeHighlighted;
    if (shouldFadeNode) return;
    
    setHoverId(node.id);
    setHoveredNodeId(node.id); // 노드 hover 상태 설정
    const filePath = (node.data as any)?.file;
    const functionName = (node.data as any)?.originalName || (node.data as any)?.label;
    const lineStart = (node.data as any)?.line_start;
    
    if (!filePath || !functionName) {
      setSnippet('');
      return;
    }

    const cleanPath = cleanFilePath(filePath, TARGET_FOLDER);
    
    // 현재 에디터에 같은 파일이 열려있고, 같은 라인 영역이 표시되고 있는지 확인
    const editorState = useEditor.getState();
    const currentActivePath = editorState.tabs.find(t => t.id === editorState.activeId)?.path ?? '';
    const currentLine = editorState.line;
    
    const isFileCurrentlyOpen = currentActivePath && 
      cleanFilePath(currentActivePath, TARGET_FOLDER) === cleanPath;
    
    // 같은 파일이 열려있고, 라인 정보가 있으며, 현재 표시된 라인과 유사한 범위라면
    if (isFileCurrentlyOpen && lineStart && currentLine && 
        Math.abs(currentLine - lineStart) <= 5) { // 5줄 이내 차이면 같은 영역으로 간주
      setSnippet('(code is already open in the editor)');
      return;
    }
    
    const cacheKey = `${cleanPath}_${functionName}`;
    
    try {
      let code = snippetCache.get(cacheKey);
      if (!code) {
        const response = await fetch(`/api/file?path=${encodeURIComponent(cleanPath)}`);
        code = await response.text();
      }
      
      const result = extractCodeSnippet(code, functionName);
      if (result) {
        snippetCache.set(cacheKey, result.snippet);
        setSnippet(highlightWithLineNumbers(result.snippet, result.startLine));
      } else if (functionName.includes('.main')) {
        // script파일의 'main' 함수의 경우 특별 처리
        const mainSnippet = code.split('\n').slice(0, 50).join('\n'); // 첫 50줄만 가져오기
        setSnippet(highlightWithLineNumbers(mainSnippet, 1));
      } else {
        setSnippet('(code definition not found)');
      }
    } catch {
      setSnippet('(preview unavailable)');
    }
  }, [highlightedNodeIds]);

  const onNodeMouseLeave = useCallback(() => {
    // 선택된 노드가 없을 때만 snippet을 지움
    if (!selectedNodeId) {
      setHoverId(null);
      setSnippet('');
    } else {
      setHoverId(null);
      // 선택된 노드가 있으면 hover snippet은 지우되 selected snippet은 유지
    }
    setHoveredNodeId(null); // 노드 hover 상태 해제
  }, [selectedNodeId]);

  // Handle node changes (for React Flow)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  // Define node types
  const nodeTypes = useMemo(() => ({
    group: CustomGroupNode,
    customNode: CustomNode
  }), []);

  const handleCFGPanelUpdate = useCallback((id: string, updates: Partial<CFGPanel>) => {
    setCfgPanels(panels => panels.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const handleCFGPanelClose = useCallback((id: string) => {
    setCfgPanels(panels => panels.filter(p => p.id !== id));
  }, []);

  const handleCFGNodeHover = useCallback(async (node: Node | null, panel: CFGPanel) => {
    // 이전 스트리밍이 있다면 중지
    if (currentStreamController) {
      currentStreamController.abort();
      setCurrentStreamController(null);
      setIsStreaming(false);
    }

    // 노드가 null이면 메시지만 클리어하고 리턴
    if (!node) {
      setCfgPanelMessage(null);
      return;
    }

    const { line_start, line_end } = node.data as any;
    
    // 새로운 AbortController 생성
    const abortController = new AbortController();
    setCurrentStreamController(abortController);
    
    // Reset streaming state
    setIsStreaming(true);
    setStreamingText('');
    
    setCfgPanelMessage(
      `<div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
        <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
          설명을 불러오는 중입니다<span class="blinking-cursor">|</span>
        </span>
      </div>`
    );

    openFile(TARGET_FOLDER + '/' + panel.file, line_start, { from: line_start, to: line_end });

    try {
      const response = await fetch(`${apiUrl}${ENDPOINTS.INLINE_CODE_EXPLANATION_STREAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file_path: TARGET_FOLDER + '/' + panel.file, 
          line_start, 
          line_end,
          explanation_level: panel.explanationLevel || 5
        }),
        signal: abortController.signal, // AbortController 신호 추가
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedText = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            setIsStreaming(false);
            setCurrentStreamController(null);
            break;
          }
          
          // 중지 신호가 온 경우 스트리밍 중단
          if (abortController.signal.aborted) {
            break;
          }
          
          const chunk = new TextDecoder().decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr.trim()) {
                try {
                  const data = JSON.parse(dataStr);
                  
                  if (data.error) {
                    throw new Error(data.error);
                  }
                  
                  if (data.chunk) {
                    accumulatedText += data.chunk;
                    setStreamingText(accumulatedText);
                    
                    // 중지 신호가 온 경우 업데이트 중단
                    if (abortController.signal.aborted) {
                      break;
                    }
                    
                    // Update message with accumulated text and blinking cursor
                    setCfgPanelMessage(
                      `<div style="display:flex;align-items:flex-start;gap:8px;">
                        <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
                        <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:320px;display:inline-block;">
                          ${accumulatedText}<span class="blinking-cursor">|</span>
                        </span>
                      </div>`
                    );
                  }
                  
                  if (data.done) {
                    setIsStreaming(false);
                    setCurrentStreamController(null);
                    // Remove blinking cursor when done
                    setCfgPanelMessage(
                      `<div style="display:flex;align-items:flex-start;gap:8px;">
                        <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
                        <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:320px;display:inline-block;">
                          ${accumulatedText}
                        </span>
                      </div>`
                    );
                    break;
                  }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', dataStr);
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      setIsStreaming(false);
      setCurrentStreamController(null);
      
      // AbortError와 관련된 에러들은 정상적인 취소이므로 에러 메시지를 표시하지 않음
      const errorMessage = (error as Error).message || '';
      const errorName = (error as Error).name || '';
      
      if (
        errorName === 'AbortError' || 
        errorMessage.includes('aborted') || 
        errorMessage.includes('BodyStreamBuffer was aborted') ||
        errorMessage.includes('fetch was aborted')
      ) {
        console.log('Streaming was intentionally aborted');
        return;
      }
      
      // 실제 에러만 로그와 UI에 표시
      console.error('Streaming error:', error);
      setCfgPanelMessage(
        `<div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:22px;line-height:1.1;">🧑‍🔬</span>
          <span style="background:#fffbe9;border-radius:8px;padding:7px 13px;box-shadow:0 1px 4px #0001;font-size:13px;color:#b45309;max-width:220px;display:inline-block;">
            설명을 가져오는 중 오류가 발생했습니다.
          </span>
        </div>`
      );
    }

  }, [apiUrl, openFile, currentStreamController]);

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
        body: JSON.stringify({ file_path: TARGET_FOLDER + "/" +file, function_name: functionName }),
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

      // --- CFG 노드 dagre TB 레이아웃 적용 ---
      cfgNodes = calculateCFGLayout(cfgNodes, cfgEdges, { direction: 'TB' });

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
          explanationLevel: 5, // Default explanation level
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
        const originalLabel = node.label || node.function_name || node.id;
        let displayLabel = originalLabel;
        
        // 메소드인 경우 클래스 이름 부분 제거
        const nodeType = node.node_type || 'function';
        if (nodeType === 'method' && originalLabel.includes('.')) {
          const parts = originalLabel.split('.');
          displayLabel = parts[parts.length - 1];
        }
        
        nodeWidths[node.id] = calculateNodeWidth(displayLabel);
      });
    });

    // Create nodes
    let allFunctionNodes: Node[] = [];
    let allRawEdges: RawEdge[] = [];
    
    Object.entries(json).forEach(([file, data]) => {
      // 파일별로 클래스와 메소드를 분류
      const classNodes: any[] = [];
      const methodNodes: any[] = [];
      const functionNodes: any[] = [];
      
      data.nodes.forEach(n => {
        const nodeType = n.node_type || 'function';
        if (nodeType === 'class') {
          classNodes.push(n);
        } else if (nodeType === 'method') {
          methodNodes.push(n);
        } else {
          functionNodes.push(n);
        }
      });

      // 클래스별로 메소드들을 매핑
      const classMethods: Record<string, any[]> = {};
      methodNodes.forEach(method => {
        // 메소드 ID에서 클래스 이름 추출 (예: "data_augmentation.ImageGenerator.method_name")
        const parts = method.id.split('.');
        if (parts.length >= 3) {
          const className = parts[1]; // ImageGenerator
          const classNodeId = `${parts[0]}.${className}`; // data_augmentation.ImageGenerator
          if (!classMethods[classNodeId]) {
            classMethods[classNodeId] = [];
          }
          classMethods[classNodeId].push(method);
        }
      });

      // 모든 노드 생성
      const allNodesRaw = [...classNodes, ...methodNodes, ...functionNodes];
      const allNodes: any[] = [];
      allNodesRaw.forEach(n => {
        // 중복 ID 방지 – 이미 추가된 노드는 건너뜀
        if (allFunctionNodes.some(existing => existing.id === n.id)) return;

        const nodeType = n.node_type || 'function';
        const isClass = nodeType === 'class';
        const isMethod = nodeType === 'method';
        
        // 메소드인 경우 부모 클래스 찾기
        let parentId = undefined;
        if (isMethod) {
          const parts = n.id.split('.');
          if (parts.length >= 3) {
            const className = parts[1];
            const classNodeId = `${parts[0]}.${className}`;
            parentId = classNodeId;
          }
        }
        
        // 노드 타입에 따른 스타일 설정
        let nodeStyle: CSSProperties = {
          padding: '6px 8px',
          borderRadius: 4,
          width: nodeWidths[n.id],
          fontSize: STYLES.NODE.FONT_SIZE,
          fontFamily: STYLES.NODE.FONT_FAMILY,
        };

        if (isClass) {
          // 클래스는 메소드들을 포함할 수 있도록 더 큰 크기로 설정
          const methods = classMethods[n.id] || [];
          const methodCount = methods.length;
          
          nodeStyle = {
            ...nodeStyle,
            border: `2px solid ${STYLES.COLORS.NODE.CLASS.BORDER}`,
            background: STYLES.COLORS.NODE.CLASS.DEFAULT,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'flex-start', // 클래스명을 상단에 배치
            justifyContent: 'center',
            textAlign: 'center',
            // 크기는 calculateLayoutWithClasses에서 동적으로 계산됨
          } as CSSProperties;
        } else if (isMethod) {
          nodeStyle = {
            ...nodeStyle,
            border: `1px solid ${STYLES.COLORS.NODE.METHOD.BORDER}`,
            background: STYLES.COLORS.NODE.METHOD.DEFAULT,
            fontSize: STYLES.NODE.FONT_SIZE, // 메소드는 기본 폰트 사용하여 타입 오류 방지
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            textAlign: 'center',
          } as CSSProperties;
        } else {
          nodeStyle = {
            ...nodeStyle,
            border: '1px solid #3b82f6',
            background: '#fff',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            textAlign: 'center',
          } as CSSProperties;
        }

        allNodes.push({
          id: n.id,
          type: 'customNode', // 커스텀 노드 타입 사용
          data: { 
            label: (() => {
              const originalLabel = n.label || n.function_name || n.id;
              // 메소드인 경우 클래스 이름 부분 제거
              if (isMethod && originalLabel.includes('.')) {
                const parts = originalLabel.split('.');
                return parts[parts.length - 1]; // 마지막 부분(메소드 이름)만 반환
              }
              // 클래스인 경우도 파일 경로 부분 제거
              if (isClass && originalLabel.includes('.')) {
                const parts = originalLabel.split('.');
                return parts[parts.length - 1]; // 마지막 부분(클래스 이름)만 반환
              }
              return originalLabel;
            })(),
            originalName: (() => {
              // 코드에서 찾을 때 사용할 원래 이름 저장
              const originalLabel = n.label || n.function_name || n.id;
              if (isMethod && originalLabel.includes('.')) {
                const parts = originalLabel.split('.');
                return parts[parts.length - 1]; // 메소드 이름
              }
              if (isClass && originalLabel.includes('.')) {
                const parts = originalLabel.split('.');
                return parts[parts.length - 1]; // 클래스 이름
              }
              return originalLabel;
            })(),
            file: n.file,
            nodeType,
            line_start: n.line_start,
            line_end: n.line_end,
          },
          position: { x: 0, y: 0 },
          style: nodeStyle,
          zIndex: isMethod ? 10 : isClass ? 1 : 5, // 메소드가 가장 위, 클래스가 가장 아래
          parentId, // 메소드인 경우 클래스 ID 설정
          extent: parentId ? ('parent' as 'parent') : undefined, // 부모 노드 내부로 제한
        });
      });
      
      allFunctionNodes = allFunctionNodes.concat(allNodes);
      allRawEdges = allRawEdges.concat(data.edges);
    });

    // Create edges
    const nodeIds = new Set(allFunctionNodes.map(n => n.id));
    const allEdges: Edge[] = allRawEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => {
        // 엣지 타입에 따른 색상 결정
        const edgeType = e.edge_type || 'function_call';
        let edgeColor: string = STYLES.COLORS.EDGE.DEFAULT;
        let strokeDasharray = undefined;
        
        switch (edgeType) {
          case 'instantiation':
            edgeColor = STYLES.COLORS.EDGE.INSTANTIATION;
            strokeDasharray = '8 4'; // 점선으로 구분
            break;
          case 'method_call':
            edgeColor = STYLES.COLORS.EDGE.METHOD_CALL;
            break;
          case 'function_call':
          default:
            edgeColor = STYLES.COLORS.EDGE.FUNCTION_CALL;
            break;
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          data: { edge_type: edgeType }, // 엣지 타입 정보 저장
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color: edgeColor,
          },
          animated: true,
          style: { 
            stroke: edgeColor, 
            strokeWidth: 2,
            strokeDasharray
          },
          zIndex: 10000,
          type: 'smoothstep',
        };
      });

    // 클래스와 메소드를 고려한 레이아웃 계산
    const posMap = calculateLayoutWithClasses(json, nodeWidths);
    const laidOutNodes = allFunctionNodes.map(n => {
      const layoutInfo = posMap[n.id];
      const nodeStyle = { ...n.style };
      
      // 레이아웃에서 계산된 크기 정보 적용
      if (layoutInfo && layoutInfo.width !== undefined) {
        nodeStyle.width = layoutInfo.width;
      }
      if (layoutInfo && layoutInfo.height !== undefined) {
        nodeStyle.height = layoutInfo.height;
        nodeStyle.minHeight = layoutInfo.height;
      }
      
      return {
        ...n,
        position: layoutInfo ?? { x: 0, y: 0 },
        style: nodeStyle,
      } as Node;
    });

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
      const widths = nodesInGroup.map(n => (n.style?.width as number) || 120);
      const heights = nodesInGroup.map(n => (n.style?.height as number) || (LAYOUT_RULES.NODE_PADDING_Y * 2 + 16));
      
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
      const maxY = Math.max(...ys.map((y, i) => y + heights[i]));
      
      groupBounds[file] = { minX, minY, maxX, maxY };
    });

    // Detect and resolve overlaps between groups
    const files = Object.keys(groupBounds);
    const groupPadding = STYLES.GROUP.PADDING;
    const minGroupSpacing = 100; // 그룹 간 최소 간격 (이전 40)
    
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
        type: 'group', // use custom group node for better label rendering
        data: {
          label: file.split('/').pop() || file,
          file,
          nodeType: 'file',
          isCollapsed: false,
          onToggleCollapse: () => {},
        },
        position: {
          x: bounds.minX - groupPadding,
          y: bounds.minY - groupPadding,
        },
        style: {
          width: bounds.maxX - bounds.minX + 2 * groupPadding,
          height: bounds.maxY - bounds.minY + 2 * groupPadding,
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px dashed #fb923c',
          borderRadius: 8,
          pointerEvents: 'none',
        },
        zIndex: 10, // file group under folder groups
      });
      
      // Update node positions to be relative to group
      nodesInGroup.forEach(node => {
        node.position = {
          x: node.position.x - (bounds.minX - groupPadding),
          y: node.position.y - (bounds.minY - groupPadding),
        };
        
        // 메소드 노드가 아닌 경우에만 파일 그룹의 자식으로 설정
        // 메소드 노드는 이미 클래스 노드의 자식으로 설정되어 있음
        const nodeType = (node.data as any)?.nodeType || 'function';
        if (nodeType !== 'method' && !node.parentId) {
          node.parentId = groupId;
          node.extent = 'parent';
        }
      });
    });

    // ---------- 재귀적 폴더 그룹 생성 (N 레벨) ----------
    // 1) 모든 폴더 경로 수집
    const fileGroupByPath: Record<string, Node> = {};
    groupNodes.forEach(fg => {
      const filePath = (fg.data as any)?.file as string | undefined;
      if (filePath) fileGroupByPath[filePath] = fg;
    });

    const folderPathsSet = new Set<string>();
    Object.keys(fileGroupByPath).forEach(fp => {
      const dirs = fp.split('/');
      // remove filename
      dirs.pop();
      let current = '';
      dirs.forEach(dir => {
        current = current ? `${current}/${dir}` : dir;
        folderPathsSet.add(current);
      });
    });

    // Helper to sanitize id
    const idFromPath = (p: string) => `folder-${p.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Map path -> group node (once created)
    const folderGroupMap: Record<string, Node> = {};

    // Convert set to array sorted by depth DESC (깊은 폴더부터) so 자식 폴더가 먼저 생성되어 부모가 포함 가능
    const folderPaths = Array.from(folderPathsSet).sort((a, b) => b.split('/').length - a.split('/').length);

    folderPaths.forEach(folderPath => {
      // Immediate child nodes = (a) file groups directly in this folder, (b) sub-folder groups one level deeper
      const childFileGroups = Object.entries(fileGroupByPath)
        .filter(([filePath]) => filePath.startsWith(folderPath + '/') && filePath.split('/').length === folderPath.split('/').length + 1)
        .map(([, node]) => node);

      const childFolderGroups = Object.entries(folderGroupMap)
        .filter(([childPath]) => childPath.startsWith(folderPath + '/') && childPath.split('/').length === folderPath.split('/').length + 1)
        .map(([, node]) => node);

      // 폴더 그룹(childFolderGroups)이 grid 상에서 먼저(상단) 오도록 순서 변경
      const childrenNodes = [...childFolderGroups, ...childFileGroups];
      if (childrenNodes.length === 0) return; // nothing inside

      // --- Grid layout (up to 3 columns) to reduce vertical length and avoid overlap ---
      const MAX_COLS = 3;
      const spacingX = 16; // tighter horizontal gap
      const spacingY = 16; // tighter vertical gap

      // Determine uniform cell size based on largest child
      let cellW = 0;
      let cellH = 0;
      childrenNodes.forEach(c => {
        const w = (c.style?.width as number) || 120;
        const h = (c.style?.height as number) || 80;
        if (w > cellW) cellW = w;
        if (h > cellH) cellH = h;
      });
      if (cellW === 0) cellW = 120;
      if (cellH === 0) cellH = 80;

      const HEADER_H = 32; // space for collapse header
      const groupPaddingTop = groupPadding + HEADER_H;
      // adjust children positions
      childrenNodes.forEach((child, idx) => {
        const col = idx % MAX_COLS;
        const row = Math.floor(idx / MAX_COLS);
        const posX = groupPadding + col * (cellW + spacingX);
        const posY = groupPaddingTop + row * (cellH + spacingY);
        child.position = { x: posX, y: posY };
      });
      const rows = Math.ceil(childrenNodes.length / MAX_COLS);
      const cols = Math.min(childrenNodes.length, MAX_COLS);
      const maxY = groupPaddingTop + rows * cellH + (rows - 1) * spacingY;
      const maxX = groupPadding + cols * cellW + (cols - 1) * spacingX;
      
      // Keep previously set absolute position if exists, else use current layout positions
      const absOffsetX = folderGroupMap[folderPath]?.position.x ?? 0;
      const absOffsetY = folderGroupMap[folderPath]?.position.y ?? 0;

      const groupId = idFromPath(folderPath);

      const groupNode: Node = {
        id: groupId,
        type: 'group',
        data: { label: folderPath.split('/').pop() || folderPath, folderPath },
        position: { x: absOffsetX, y: absOffsetY },
        style: {
          width: maxX + groupPadding,
          height: maxY + groupPadding,
          background: 'rgba(0,0,0,0.03)',
          border: '1px dashed #94a3b8',
          borderRadius: 10,
          pointerEvents: 'auto',
          overflow: 'visible',
        },
        zIndex: 40, // folder group above file groups
      } as Node;

      // Adjust children positions with absolute offset
      childrenNodes.forEach(child => {
        child.position = {
          x: child.position.x + absOffsetX,
          y: child.position.y + absOffsetY,
        };
      });

      folderGroupMap[folderPath] = groupNode;

      // 자식노드 위치/parent 지정
      childrenNodes.forEach(child => {
        child.parentId = groupId;
        child.extent = 'parent';
      });
    });

    const folderGroupNodes = Object.values(folderGroupMap);
    const allGroupNodes = [...folderGroupNodes, ...groupNodes].sort((a, b) => {
      const depthA = ((a.data as any)?.folderPath || (a.data as any)?.file || '').split('/').length;
      const depthB = ((b.data as any)?.folderPath || (b.data as any)?.file || '').split('/').length;
      return depthA - depthB;
    });

    // 상태 반영 (부모 → 자식 순)
    setNodes([...allGroupNodes, ...laidOutNodes]);
    setEdges(allEdges);

    // --- 초기 상태: 모든 그룹 노드를 접힌(collapse) 상태로 ---
    const initialCollapsedIds = allGroupNodes.map(g => g.id);
    setCollapsedGroups(new Set(initialCollapsedIds));
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
      
      // Skip self-edges within a collapsed group, but do not hide other edges
      if (sourceRep === targetRep) {
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
      const isNodeHoverConnected = hoveredNodeId && (finalEdge.source === hoveredNodeId || finalEdge.target === hoveredNodeId);
      const isNodeSelectedConnected = selectedNodeId && (finalEdge.source === selectedNodeId || finalEdge.target === selectedNodeId);
      const isEdgeHighlighted = highlightedNodeIds.has(finalEdge.source) && highlightedNodeIds.has(finalEdge.target);
      
      // 하이라이트 모드에서 음영 처리 여부 결정
      const shouldFadeEdge = highlightedNodeIds.size > 0 && !isEdgeHighlighted;
      const opacity = shouldFadeEdge ? (100 - fadeOpacity) / 100 : 1;
      
      // 엣지 타입에 따른 기본 색상 결정
      const edgeType = finalEdge.data?.edge_type || 'function_call';
      let baseColor: string = STYLES.COLORS.EDGE.DEFAULT;
      
      switch (edgeType) {
        case 'instantiation':
          baseColor = STYLES.COLORS.EDGE.INSTANTIATION;
          break;
        case 'method_call':
          baseColor = STYLES.COLORS.EDGE.METHOD_CALL;
          break;
        case 'function_call':
        default:
          baseColor = STYLES.COLORS.EDGE.FUNCTION_CALL;
          break;
      }
      
      // 상태에 따른 최종 색상 결정
      const finalColor = isHover || isNodeHoverConnected || isNodeSelectedConnected
        ? STYLES.COLORS.EDGE.HOVER 
        : isEdgeHighlighted
          ? STYLES.COLORS.EDGE.HIGHLIGHTED
          : baseColor;
      
      return {
        ...finalEdge,
        hidden: false,
        style: {
          ...(finalEdge.style || {}),
          stroke: finalColor,
          strokeWidth: isHover || isNodeHoverConnected || isNodeSelectedConnected ? 4 : isEdgeHighlighted ? 3 : (isRedirected ? 3 : 2),
          strokeDasharray: isRedirected ? '5 5' : finalEdge.style?.strokeDasharray,
          transition: 'all 0.13s',
          cursor: shouldFadeEdge ? 'default' : 'pointer', // 음영 처리된 엣지는 클릭 불가능한 것처럼 보이게
          opacity,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: finalColor,
          ...(finalEdge.markerEnd as any || {}),
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
  }, [edges, collapsedGroups, nodes, hoveredEdgeId, hoveredNodeId, selectedNodeId, highlightedNodeIds, fadeOpacity]);

  // Process nodes for styling
  const finalNodes = useMemo(() => {
    // 숨김 여부만 설정하고 모든 노드를 그대로 전달해야 Edge 단절이 발생하지 않음
    return nodes.map(n => {
      const cleanPath = cleanFilePath((n.data as any)?.file || '', TARGET_FOLDER);
      const isActive = cleanPath === activePath;
      const isHover = hoverId === n.id;
      const isSelected = selectedNodeId === n.id;
      const isNodeHighlighted = highlightedNodeIds.has(n.id);
      const isGroup = n.type === 'group';
      const isCollapsed = isGroup && collapsedGroups.has(n.id);
      const isHidden = isNodeHidden(n.id, collapsedGroups, nodes);
      
      // 하이라이트 모드에서 음영 처리 여부 결정
      // 그룹 노드의 경우: 그룹에 속한 자식 노드 중 하이라이트된 노드가 있는지 확인
      let shouldFadeNode = false;
      let opacity = 1;
      
      if (highlightedNodeIds.size > 0) {
        if (isGroup) {
          // 그룹 노드의 경우: 자식 노드 중 하이라이트된 노드가 있는지 확인
          const hasHighlightedChild = nodes.some(childNode => 
            childNode.parentId === n.id && highlightedNodeIds.has(childNode.id)
          );
          shouldFadeNode = !hasHighlightedChild;
        } else {
          // 일반 노드의 경우: 직접 하이라이트되지 않았으면 음영 처리
          shouldFadeNode = !isNodeHighlighted;
        }
        
        if (shouldFadeNode) {
          opacity = (100 - fadeOpacity) / 100;
        }
      }
      
      // 노드 타입 확인
      const nodeType = (n.data as any)?.nodeType || 'function';
      const isClass = nodeType === 'class';
      const isMethod = nodeType === 'method';

      // 노드 타입에 따른 배경색 및 테두리 색상 결정
      let backgroundColor: string = STYLES.COLORS.NODE.DEFAULT;
      let borderColor: string = STYLES.COLORS.NODE.BORDER;

      if (isGroup) {
        backgroundColor = isCollapsed 
          ? STYLES.COLORS.GROUP.COLLAPSED
          : isHover
            ? STYLES.COLORS.NODE.HOVER
            : isSelected
              ? STYLES.COLORS.NODE.SELECTED
              : isActive
                ? STYLES.COLORS.NODE.ACTIVE
                : STYLES.COLORS.GROUP.DEFAULT;
      } else if (isClass) {
        backgroundColor = isSelected
          ? STYLES.COLORS.NODE.CLASS.SELECTED
          : isHover
            ? STYLES.COLORS.NODE.CLASS.HOVER
            : isNodeHighlighted
              ? STYLES.COLORS.NODE.HIGHLIGHTED
              : isActive
                ? STYLES.COLORS.NODE.ACTIVE
                : STYLES.COLORS.NODE.CLASS.DEFAULT;
        borderColor = STYLES.COLORS.NODE.CLASS.BORDER;
      } else if (isMethod) {
        backgroundColor = isSelected
          ? STYLES.COLORS.NODE.METHOD.SELECTED
          : isHover
            ? STYLES.COLORS.NODE.METHOD.HOVER
            : isNodeHighlighted
              ? STYLES.COLORS.NODE.HIGHLIGHTED
              : isActive
                ? STYLES.COLORS.NODE.ACTIVE
                : STYLES.COLORS.NODE.METHOD.DEFAULT;
        borderColor = STYLES.COLORS.NODE.METHOD.BORDER;
      } else {
        backgroundColor = isSelected
          ? STYLES.COLORS.NODE.SELECTED
          : isHover
            ? STYLES.COLORS.NODE.HOVER
            : isNodeHighlighted
              ? STYLES.COLORS.NODE.HIGHLIGHTED
              : isActive
                ? STYLES.COLORS.NODE.ACTIVE
                : STYLES.COLORS.NODE.DEFAULT;
      }

      const styledNode: CSSProperties = {
        ...n.style,
        background: backgroundColor,
        // --- 안정적 그룹 테두리: 폭 고정 2px -------------
        border: isGroup
          ? `2px solid ${isCollapsed ? STYLES.COLORS.GROUP.BORDER_COLLAPSED : STYLES.COLORS.GROUP.BORDER}`
          : isSelected
            ? `2px solid ${STYLES.COLORS.NODE.BORDER_SELECTED}`
            : `1px solid ${borderColor}`,
        // Hover / Active 하이라이트는 box-shadow 로, 레이아웃 영향 無
        boxShadow: isGroup && (isHover || isActive) ? `0 0 0 3px ${STYLES.COLORS.NODE.BORDER_HOVER}` : undefined,
        // Smoothly animate size and position changes (e.g., group collapse / expand)
        transition: 'box-shadow 0.15s, background 0.1s, width 0.2s ease, height 0.2s ease, transform 0.2s ease',
        // --- 크기 스케일 적용 (그룹 노드 제외) -----------------------
        minWidth: isGroup ? (isCollapsed ? calculateNodeWidth((n.data as any)?.label || '') + 80 : undefined) : (n.style?.width as number),
        width: isGroup && isCollapsed ? calculateNodeWidth((n.data as any)?.label || '') + 80 : n.style?.width,
        height: isGroup && isCollapsed ? STYLES.GROUP.COLLAPSED_HEIGHT : ((n.style?.height as number) || (LAYOUT_RULES.NODE_PADDING_Y * 2 + 16)),
        padding: '2px 6px 4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: isGroup && isCollapsed ? 'pointer' : shouldFadeNode ? 'default' : 'default',
        opacity,
        pointerEvents: shouldFadeNode ? ('none' as const) : ('auto' as const),
      } as CSSProperties;

      return {
        ...n,
        type: isGroup ? 'group' : 'customNode', // 그룹이 아닌 경우 customNode 타입 사용
        hidden: isHidden,
        style: styledNode,
        data: isGroup
          ? {
              ...(n.data as any),
              isCollapsed,
              onToggleCollapse: () => toggleCollapse(n.id),
            }
          : n.data,
      } as Node;
    });
  }, [nodes, activePath, hoverId, selectedNodeId, collapsedGroups, toggleCollapse, highlightedNodeIds, fadeOpacity]);

  // Update group node data when collapsedGroups changes
  useEffect(() => {
    setNodes(nds => nds.map(n => {
      if (n.type === 'group') {
        return {
          ...n,
          data: {
            ...(n.data as any),
            isCollapsed: collapsedGroups.has(n.id),
            onToggleCollapse: () => toggleCollapse(n.id),
          },
        } as Node;
      }
      return n;
    }));
  }, [collapsedGroups, toggleCollapse]);

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
    <div className="w-full h-full bg-gray-50 relative">
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
          <div className="text-lg font-medium text-gray-600">Loading diagram...</div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="text-red-600 text-lg font-medium mb-2">Error loading diagram</div>
            <div className="text-gray-600">{error}</div>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={finalNodes}
        edges={processedEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        // onEdgeMouseEnter={(_, edge) => {
        //   // 음영 처리된 엣지는 호버 이벤트 무시
        //   const isEdgeHighlighted = highlightedNodeIds.has(edge.source) && highlightedNodeIds.has(edge.target);
        //   const shouldFadeEdge = highlightedNodeIds.size > 0 && !isEdgeHighlighted;
        //   if (!shouldFadeEdge) {
        //     setHoveredEdgeId(edge.id);
        //   }
        // }}
        // onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        fitView
        fitViewOptions={{ 
          padding: 0.15, // Increased padding for better initial view
          minZoom: 0.3,  // Lower minimum zoom to see more
          maxZoom: 2.0   // Higher maximum zoom for detail view
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }} // Better initial zoom level
        minZoom={0.1}
        maxZoom={3}
        className="bg-gray-50"
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSelectedSnippet(''); // 선택 해제 시 snippet도 제거
          setCfgMessage(null);
        }}
        defaultEdgeOptions={{
          type: 'smoothstep', // Use smooth curved edges instead of straight lines
          animated: false,
          style: { 
            strokeWidth: 1.5, // Slightly thicker edges for better visibility
            stroke: STYLES.COLORS.EDGE.DEFAULT 
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
        }}
        connectionLineStyle={{ strokeWidth: 1.5 }}
        snapToGrid={false}
        snapGrid={[15, 15]}
        panOnScroll={true}
        selectionOnDrag={false}
        panOnDrag={true}
        selectNodesOnDrag={false}
        multiSelectionKeyCode={null} // Disable multi-selection for cleaner UX
        deleteKeyCode={null} // Disable delete key
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false} // Keep disabled to avoid node dbl-click conflict
        preventScrolling={true}
        elementsSelectable={true}
        nodesConnectable={false}
        /* Removed nodesDraggable and nodesFocusable to rely on defaults for better pan/zoom */
      >
        {/* Improved background with subtle grid */}
        <Background 
          color="#e2e8f0" 
          gap={20} 
          size={1}
          variant={"dots" as any}
          style={{ opacity: 0.4 }}
        />
        
        {/* MiniMap moved to bottom-right */}
        <MiniMap 
          nodeColor={(node) => {
            if (node.type === 'group') return '#9ca3af'; // Gray for groups
            return '#2563eb'; // Blue for regular nodes
          }}
          nodeStrokeColor={(node) => {
            if (node.type === 'group') return '#4b5563';
            return '#1e3a8a';
          }}
          nodeStrokeWidth={1}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #e2e8f0',
            borderRadius: '8px'
          }}
          pannable
          zoomable
          position="bottom-right"
        />
        
        {/* Enhanced Controls (moved to bottom-left) */}
        <Controls 
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #e2e8f0',
            borderRadius: '8px'
          }}
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          position="bottom-left"
        >
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
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <polyline points="7.5,4.5 12,9 7.5,13.5" stroke="#222" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
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

        {/* Overlay buttons removed - using internal buttons */}

        {/* Fade Level Control - 하이라이트가 활성화된 경우에만 표시 */}
        {highlightedNodeIds.size > 0 && (
          <div className="absolute top-4 left-4 bg-white p-3 rounded-lg shadow-md border border-gray-200 z-50">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-700 font-medium whitespace-nowrap">Fade Level:</span>
              <input
                type="range"
                min="0"
                max="100"
                step="10"
                value={fadeOpacity}
                onChange={(e) => {
                  const newOpacity = Number(e.target.value);
                  setFadeOpacity(newOpacity);
                  // 전역 함수를 통해 fadeOpacity 업데이트 (현재 하이라이트 유지)
                  if ((window as any).updateHighlightedNodes && highlightedNodeIds.size > 0) {
                    (window as any).updateHighlightedNodes(Array.from(highlightedNodeIds), newOpacity);
                  }
                }}
                className="w-24 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #6b7280 0%, #6b7280 ${fadeOpacity}%, #d1d5db ${fadeOpacity}%, #d1d5db 100%)`
                }}
              />
              <span className="text-xs text-gray-700 font-mono min-w-[3ch] text-center">{fadeOpacity}%</span>
            </div>
          </div>
        )}
        
        {cfgMessage && (
          <div className="absolute top-[60px] right-6 bg-red-100 text-red-800 px-4 py-2 rounded-md z-[100] text-sm shadow-md">
            {cfgMessage}
          </div>
        )}
      </ReactFlow>
      
      {/* Snippet display - 메인 ReactFlow 외부로 이동 */}
      {(hoverId && snippet) || (selectedNodeId && selectedSnippet) ? (
        <div
          className="fixed z-50 top-4 right-4 min-w-[320px] max-w-[40vw] min-h-[40px] max-h-[80vh] bg-gray-50 text-slate-800 text-xs rounded-lg shadow-lg p-4 overflow-y-auto overflow-x-auto font-mono pointer-events-auto"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e1 #f1f5f9'
          }}
        >
          <pre 
            className="hljs m-0 p-0 bg-transparent overflow-visible whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: selectedNodeId && selectedSnippet ? selectedSnippet : snippet }}
          />
        </div>
      ) : null}
      
      {/* Highlighted nodes info - 메인 ReactFlow 외부로 이동 */}
      {highlightedNodeIds.size > 0 && (
        <div className="absolute top-16 left-4 bg-white p-3 rounded-lg shadow-md border border-gray-200 z-50">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-700 font-medium whitespace-nowrap">Highlighted Nodes:</span>
            <span className="text-xs text-gray-500 font-semibold">{highlightedNodeIds.size}</span>
          </div>
        </div>
      )}
      
      {/* CFG Panels - 메인 ReactFlow 외부로 이동 */}
      {cfgPanels.map((panel, idx) => (
        <CFGPanelComponent
          key={panel.id}
          panel={panel}
          index={idx}
          onUpdate={handleCFGPanelUpdate}
          onClose={handleCFGPanelClose}
          onNodeHover={handleCFGNodeHover}
          onClearMessage={() => setCfgPanelMessage(null)}
          message={cfgPanelMessage}
        />
      ))}
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
  onClearMessage,
  message,
}: {
  panel: CFGPanel;
  index: number;
  onUpdate: (id: string, updates: Partial<CFGPanel>) => void;
  onClose: (id: string) => void;
  onNodeHover: (node: Node | null, panel: CFGPanel) => void;
  onClearMessage: () => void;
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
        zIndex: 1000 + index,
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
            top: panel.expanded ? 48 : 38, // Position below the header
            right: 12,
            zIndex: 300,
            fontSize: 13,
            fontWeight: 500,
            pointerEvents: 'none',
            maxWidth: panel.expanded ? 340 : 280, // Adjust width based on panel state
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
        
        {/* Explanation Level Slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            background: '#e2e8f0',
            borderRadius: 4,
            fontSize: 11,
            color: '#64748b',
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>Level:</span>
          <input
            type="range"
            min="1"
            max="10"
            value={panel.explanationLevel || 5}
            onChange={(e) => {
              e.stopPropagation();
              onUpdate(panel.id, { explanationLevel: parseInt(e.target.value, 10) });
            }}
            style={{
              width: 60,
              height: 12,
              cursor: 'pointer',
              background: 'transparent',
            }}
            title={`Explanation Level: ${panel.explanationLevel || 5}/10`}
          />
          <span style={{ minWidth: 14, textAlign: 'center', fontWeight: 600 }}>
            {panel.explanationLevel || 5}
          </span>
        </div>
        
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
            <path d="M4 6l4 4 4-4" stroke="#888" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
              <ReactFlowProvider>
                <ReactFlow
                  key={`cfg-${panel.id}`}
                  nodes={panel.result.nodes}
                  edges={panel.result.edges}
                  nodeTypes={{}}
                  fitView
                  minZoom={0.2}
                  maxZoom={2}
                  className="bg-gray-50"
                  style={{ width: '100%', height: '100%' }}
                  defaultViewport={{ x: 0, y: 0, zoom: 1.2 }}
                  onNodeMouseEnter={(_, node) => onNodeHover(node, panel)}
                  onNodeMouseLeave={() => onNodeHover(null, panel)}
                  onPaneClick={() => {
                    onClearMessage();
                  }}
                  preventScrolling={false}
                  elementsSelectable={true}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  panOnDrag={true}
                  zoomOnScroll={true}
                  selectNodesOnDrag={false}
                >
                  <Background variant={"dots" as any} gap={16} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </ReactFlowProvider>
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
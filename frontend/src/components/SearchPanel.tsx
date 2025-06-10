'use client';

import { useState, useEffect, useMemo } from 'react';
import { useEditor } from '@/store/editor';
import { nanoid } from 'nanoid';
import { useFS, getAllFilePaths } from '@/store/files';

const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER;

// 타입 정의: 검색 결과는 파일, 라인, 라인 텍스트
type SearchResult = {
  file: string;
  line: number;
  text: string;
};

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<{ [file: string]: boolean }>({});
  const { tree, fileContents } = useFS();

  const allFiles = useMemo(() => getAllFilePaths(tree, false), [tree]); // 폴더 제외, 파일만

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const results: SearchResult[] = [];
    for (const file of allFiles) {
      const content = fileContents[file];
      if (!content) continue;
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            file,
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    }
    setSearchResults(results);
  }, [query, allFiles, fileContents]);

  // 파일별로 결과를 그룹화
  const groupedResults = useMemo(() => {
    const groups: { [file: string]: SearchResult[] } = {};
    for (const result of searchResults) {
      if (!groups[result.file]) groups[result.file] = [];
      groups[result.file].push(result);
    }
    return groups;
  }, [searchResults]);

  // 검색 결과가 바뀌면 모든 파일을 expand
  useEffect(() => {
    const initial: { [file: string]: boolean } = {};
    Object.keys(groupedResults).forEach((file) => {
      initial[file] = true;
    });
    setExpandedFiles(initial);
  }, [groupedResults]);

  const handleToggleFile = (file: string) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [file]: !prev[file],
    }));
  };

  const handleResultClick = (result: SearchResult) => {
    const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);

    const cleanPath = result.file.replace(regex, '');
    const name = cleanPath.split('/').pop() || cleanPath;
    const editorState = useEditor.getState();
    editorState.open({
      id: nanoid(),
      path: cleanPath,
      name,
    });
    // 검색어가 있으면 하이라이트를 위해 저장
    if (query.trim()) {
      editorState.setSearchHighlights(result.line, query);
    }
  };

  return (
    <div className="w-full h-full p-2 bg-slate-50 border-r border-slate-300">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search in all files..."
        className="w-full p-2 mb-2 border rounded"
      />
      <div className="overflow-y-auto max-h-[calc(100%-2rem)]">
        {query.trim() === '' ? (
          <p className="text-xs text-gray-500">Enter a keyword</p>
        ) : searchResults.length > 0 ? (
          Object.entries(groupedResults).map(([file, results]) => (
            <div key={file} className="mb-2">
              <div
                className="font-mono text-xs font-semibold text-slate-700 mb-1 flex items-center cursor-pointer select-none"
                onClick={() => handleToggleFile(file)}
              >
                <span className="mr-1">
                  {expandedFiles[file] ? '▼' : '▶'}
                </span>
                {file}
                <span className="ml-2 text-slate-400">({results.length})</span>
              </div>
              {expandedFiles[file] && results.map((result, i) => (
                <div
                  key={i}
                  onClick={() => handleResultClick(result)}
                  className="text-xs py-1 px-2 hover:bg-slate-100 cursor-pointer flex"
                >
                  <span className="text-slate-400 mr-2">:{result.line}</span>
                  <span className="truncate text-slate-600">{result.text}</span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <p className="text-xs text-gray-500">No search results found</p>
        )}
      </div>
    </div>
  );
}
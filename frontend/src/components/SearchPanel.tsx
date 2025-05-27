'use client';

import { useState, useEffect } from 'react';
import { useEditor } from '@/store/editor';
import { nanoid } from 'nanoid';
import { useFS, getAllFilePaths } from '@/store/files';

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const { tree, fileContents } = useFS();

  const allFiles = getAllFilePaths(tree, false); // 폴더 제외, 파일만

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const results = allFiles.filter((file) => {
      const content = fileContents[file];
      return content && content.toLowerCase().includes(query.toLowerCase());
    });
    setSearchResults(results);
  }, [query, allFiles, fileContents]);

  const handleFileClick = (path: string) => {
    const cleanPath = path.replace(/^poc[\\/]/, '');
    const name = cleanPath.split('/').pop() || cleanPath;
    const editorState = useEditor.getState();
    editorState.open({
      id: nanoid(),
      path: cleanPath,
      name,
    });
    // 검색어가 있으면 하이라이트를 위해 저장
    if (query.trim()) {
      // 파일 내용에서 검색어의 첫 번째 위치를 찾아 라인 번호를 계산
      const content = fileContents[path] || '';
      const lines = content.split('\n');
      const line = lines.findIndex((line) => line.toLowerCase().includes(query.toLowerCase())) + 1;
      if (line > 0) {
        editorState.setSearchHighlights(line, query);
      }
    }
  };

  return (
    <div className="w-full h-full p-2 bg-slate-50 border-r border-slate-300">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files..."
        className="w-full p-2 mb-2 border rounded"
      />
      <div className="overflow-y-auto max-h-[calc(100%-2rem)]">
        {query.trim() === '' ? (
          <p className="text-xs text-gray-500">Enter a keyword</p>
        ) : searchResults.length > 0 ? (
          searchResults.map((file, i) => (
            <div
              key={i}
              onClick={() => handleFileClick(file)}
              className="text-xs py-1 px-2 hover:bg-slate-100 cursor-pointer"
            >
              {file}
            </div>
          ))
        ) : (
          <p className="text-xs text-gray-500">No search results found</p>
        )}
      </div>
    </div>
  );
}
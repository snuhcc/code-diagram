// frontend/src/app/api/file/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// 환경변수에서 타겟 폴더 읽기
const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER!;
const TARGET_DIR = path.join(process.cwd(), '..', TARGET_FOLDER);

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('path') ?? '';

  /* ── 경로 정규화 & 보안 ─────────────────────────────── */
  const parts = raw.split(/[\\/]/).filter(p => p && p !== '..');
  
  // TARGET_FOLDER 접두사 제거 (예: "study1/face_classification/main.py" → "main.py")
  const targetParts = TARGET_FOLDER.split(/[\\/]/);
  for (let i = 0; i < targetParts.length && i < parts.length; i++) {
    if (parts[0] === targetParts[i]) {
      parts.shift();
    }
  }

  const rel = parts.join('/');             // ex) "main.py", "utils/helper.py"
  const abs = path.join(TARGET_DIR, rel);  // <root>/study1/face_classification/main.py

  try {
    // 보안 체크: TARGET_DIR 밖으로 나가는 것 방지
    const resolvedPath = path.resolve(abs);
    const resolvedTargetDir = path.resolve(TARGET_DIR);
    
    if (!resolvedPath.startsWith(resolvedTargetDir)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const text = await fs.readFile(abs, 'utf8');
    /* 기본 텍스트 응답 */
    return new NextResponse(text);
  } catch (error) {
    console.error('Error reading file:', error);
    /* 파일 못 찾으면 404 JSON */
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
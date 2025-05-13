#!/usr/bin/env python3
"""
components 폴더의 모든 파일과 app/page.tsx 내용을
[상대/경로/파일명] 헤더와 함께 하나의 txt로 모아 줍니다.
"""

from pathlib import Path

# ── 1. 경로 설정 ──────────────────────────────────────────────────────────────
ROOT  = Path(__file__).resolve().parent           # 스크립트를 둔 위치 = 프로젝트 루트
SRC   = ROOT / "src"
COMP  = SRC / "components"
PAGE  = [SRC / "app" / "page.tsx", SRC / "app" / "globals.css"]  # 오타 수정
STORE = SRC / "store"
TAIL  = SRC / "tailwind.config.js"


# ── 2. 대상 파일 수집 ─────────────────────────────────────────────────────────
targets = sorted(COMP.glob("*")) + PAGE + sorted(STORE.glob("*.ts")) + [TAIL]
print([p.relative_to(ROOT).as_posix() for p in targets])         # 확인용

# ── 3. txt 생성 ───────────────────────────────────────────────────────────────
out_path = ROOT / "project_code.txt"
with out_path.open("w", encoding="utf-8") as out:
    for file_path in targets:
        if not file_path.is_file():
            continue
        rel_path = file_path.relative_to(ROOT).as_posix()        # ← 핵심
        out.write(f"[frontend/{rel_path}]\n")
        out.write(file_path.read_text(encoding="utf-8"))
        out.write("\n\n")                                        # 파일 간 구분용 공백

print(f"✅ 완료: {out_path.relative_to(ROOT)} 생성")

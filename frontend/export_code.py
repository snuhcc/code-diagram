from pathlib import Path

ROOT  = Path(__file__).resolve().parent
SRC   = ROOT / "src"
COMP  = SRC / "components"
PAGE  = [SRC / "app" / "page.tsx", SRC / "app" / "globals.css"]
STORE = SRC / "store"
TAIL  = SRC / "tailwind.config.js"
BACKEND = (ROOT.parent / "backend" / "app").resolve()
API_FILE = SRC / "app" / "api" / 'file' / "route.ts"
API_FILES = SRC / "app" / "api" / 'files' / "route.ts"

# 대상 파일 수집
print(sorted(API_FILES.glob("*.ts")))
targets = sorted(COMP.glob("*")) + PAGE + sorted(STORE.glob("*.ts")) + [TAIL] + sorted(BACKEND.glob("*.py")) + [API_FILES] + [API_FILE]

# 상대 경로 출력 (안전하게)
def get_rel_path(p: Path) -> str:
    try:
        return p.relative_to(ROOT).as_posix()
    except ValueError:
        return p.relative_to(ROOT.parent).as_posix()  # backend용 상대경로

print([get_rel_path(p) for p in targets])

# 텍스트 생성
out_path = ROOT / "project_code.txt"
with out_path.open("w", encoding="utf-8") as out:
    for file_path in targets:
        if not file_path.is_file():
            continue
        rel_path = get_rel_path(file_path)
        out.write(f"[{rel_path}]\n")
        out.write(file_path.read_text(encoding="utf-8"))
        out.write("\n\n")

print(f"✅ 완료: {out_path.relative_to(ROOT)} 생성")

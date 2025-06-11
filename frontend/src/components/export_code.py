from pathlib import Path

COMP = Path(__file__).resolve().parent

# 특정 컴포넌트 파일만 선택
target_components = [
    COMP / "diagramUtils.tsx",
    COMP / "DiagramViewer.tsx"
]

# 존재하는 파일만 필터링
targets = [f for f in target_components if f.is_file()]

# 상대 경로 출력 함수
def get_rel_path(p: Path) -> str:
    try:
        return p.relative_to(COMP).as_posix()
    except ValueError:
        return p.relative_to(COMP.parent).as_posix()

print("선택된 파일들:")
print([get_rel_path(p) for p in targets])

# 텍스트 생성
out_path = COMP / "selected_components.txt"
with out_path.open("w", encoding="utf-8") as out:
    for file_path in targets:
        rel_path = get_rel_path(file_path)
        out.write(f"[{rel_path}]\n")
        out.write(file_path.read_text(encoding="utf-8"))
        out.write("\n\n")

print(f"✅ 완료: {out_path.relative_to(COMP)} 생성")
from pathlib import Path

# 텍스트로 처리할 확장자
TEXT_EXTS = {".py", ".md", ".txt", ".json", ".toml", ".yaml", ".yml", ".ini"}
# 건너뛸 디렉토리 이름
IGNORE_DIRS = {"__pycache__", ".pytest_cache"}

DIAGRAM_EXAMPLE = {
    "nodes": [
        {
            "id": "main.main",
            "function_name": "main",
            "file": "poc/main.py",
            "line_start": 1,
            "line_end": 17,
            "description": "Main function that orchestrates the data fetching and processing."
        },
        {
            "id": "fetcher.fetch_data",
            "function_name": "fetch_data",
            "file": "poc/fetcher.py",
            "line_start": 1,
            "line_end": 13,
            "description": "Function to fetch data from a given source."
        },
        {
            "id": "processor.process_data", #file_name.function_name
            "function_name": "process_data",          # function_name
            "file": "poc/processor.py",
            "line_start": 1,
            "line_end": 16,
            "description": "Function to process the fetched data."  # summary of function
        }
    ],
    "edges": [
        {
            "id": "main.e0",   # file_name.edge_id
            "source": "main.main",
            "target": "fetcher.fetch_data",
        },
        {
            "id": "fetcher.e1",
            "source": "fetcher.fetch_data",
            "target": "processor.process_data",
        }
    ]
}

PROMPT_CODE_TO_CG = """
    You are a SOFTWARE ENGINEERING EXPERT. You are given Python codes.
    Please generate a Call Graph for the provided code.

    INPUT:
    - The function code with line numbers:
    {repo_prompt}

    - Example output format (JSON):
    {diagram_example}

    OUTPUT:
    - The output must strictly follow the provided JSON format.
    - Only create nodes for functions or classes declared in this code.
    - If a function or class is called but not declared in this code (e.g., imported), do not create a node for it, but do create an edge to it.
    - For edges to imported functions or classes, if the import statement is like 'from A.B import C', the edge target should be 'A.B.C'.
    - Edges must represent function calls or class method calls.
    - Ignore built-in functions and standard library calls.
    - The flowchart should accurately represent the code structure.
    - Add comments in the generated flowchart for clarity.
"""

PROMPT_CODE_TO_CFG = """
    You are a SOFTWARE ENGINEERING EXPERT. You are given a Python function.
    Please generate a Control Flow Graph (CFG) for the provided code.

    INPUT:
    - The function code:
    {function_code}

    - Example output format (JSON):
    {{
        "nodes": [
            {{
                "id": "main.1",
                "label": "Start of main()",
                "file": "poc/main.py",
                "line_start": 1,
                "line_end": 1,
                "description": "Entry point of main function."
            }},
            {{
                "id": "main.2",
                "label": "If condition x > 0",
                "file": "poc/main.py",
                "line_start": 2,
                "line_end": 2,
                "description": "Conditional branch."
            }},
            // ... more nodes ...
        ],
        "edges": [
            {{
                "id": "e0",
                "source": "main.1",
                "target": "main.2",
                "description": "next number"
            }},
            {{
                "id": "e1",
                "source": "main.2",
                "target": "main.3",
                "description": "true"
            }},
            {{
                "id": "e2",
                "source": "main.2",
                "target": "main.4",
                "description": "false"
            }}
            // ... more edges ...
        ]
    }}

    OUTPUT:
    - The output must strictly follow the provided JSON format.
    - Each node should represent a basic block, statement, or control structure (e.g., condition, loop, return).
    - Edges must represent possible control flow transitions (e.g., normal, true/false for branches, loop back).
    - Only include nodes and edges for code declared in this function.
    - Ignore built-in functions and standard library calls.
    - Only visualize essential control flow relevant to the main logic of the function.
    - Omit nodes and edges for logging, debugging, or other non-essential statements that do not affect the core logic or outcome.
    - The graph should accurately represent the essential control flow structure.
    - Add comments in the generated flowchart for clarity.
"""

# def build_repo_tree(root: Path, prefix: str = "", is_sub: bool = False) -> str:
#     """
#     tree 스타일 디렉토리 구조 문자열 생성.
#     첫 호출 시, root 디렉토리 이름도 포함합니다.
#     """
#     lines = []
#     if not is_sub:
#         # 최상위 root 이름 추가
#         lines.append(f"{root.name}")
#     entries = sorted(
#         [e for e in root.iterdir() if e.name not in IGNORE_DIRS],
#         key=lambda e: (e.is_file(), e.name.lower())
#     )
#     for idx, entry in enumerate(entries):
#         connector = "└── " if idx == len(entries) - 1 else "├── "
#         lines.append(f"{prefix}{connector}{entry.name}")
#         if entry.is_dir():
#             extension = "    " if idx == len(entries) - 1 else "│   "
#             # 하위 디렉토리는 is_sub=True로 재귀 호출
#             sub_lines = build_repo_tree(entry, prefix + extension, is_sub=True).splitlines()
#             # 최상위 이름 제외한 부분만 추가
#             lines.extend(sub_lines[1:])
#     return "\n".join(lines)

# def format_file_block(path: Path, root: Path) -> str:
#     rel = path.relative_to(root)
#     size = path.stat().st_size
#     try:
#         text = path.read_text(encoding="utf-8")
#     except UnicodeDecodeError:
#         return f"# Skipped non-UTF8 file: {rel}\n"
#     lines = text.splitlines()
#     numbered = "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))
#     return (
#         f"--- FILE: {rel} ({size} bytes) ---\n"
#         f"{numbered}\n"
#         f"--- END FILE: {rel} ---\n"
#     )

# def generate_repo_prompt(root_dir: str, out_path: str = None):
#     root = Path(root_dir)

#     parts = ["=== DIRECTORY TREE ===", build_repo_tree(root), "=== END DIRECTORY TREE ===\n"]

#     for file in sorted(root.rglob("*")):
#         # 1) 폴더 제외
#         if any(part in IGNORE_DIRS for part in file.parts):
#             continue
#         # 2) 파일만, 그리고 텍스트 확장자만
#         if not file.is_file() or file.suffix.lower() not in TEXT_EXTS:
#             continue

#         parts.append(format_file_block(file, root))

#     prompt = "\n".join(parts)

#     if out_path:
#         if not out_path.endswith(".txt"):
#             out_path += ".txt"
#         with open(out_path, "w", encoding="utf-8") as f:
#             f.write(prompt)
#         print(f"Prompt saved to {out_path}")
#     else:
#         print(prompt)
#         return prompt

def generate_repo_prompt_for_file(file_path):
    """
    단일 파일에 대한 repo prompt를 생성합니다.
    각 코드 라인에 라인넘버를 포함합니다.
    """
    from pathlib import Path
    file_path = Path(file_path)
    try:
        text = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"# Skipped non-UTF8 file: {file_path.name}\n"
    lines = text.splitlines()
    numbered = "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))
    parts = [
        f"=== FILE: {file_path.name} ===",
        numbered,
        f"=== END FILE: {file_path.name} ===\n"
    ]
    return "\n".join(parts)

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python make_prompt.py <ROOT_DIR> [OUTPUT_FILE]")
    else:
        generate_repo_prompt(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
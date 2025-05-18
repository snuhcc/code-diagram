import os
import glob

def get_source_files(directory: str, file_type: str = "py"):
    """
    Recursively collect all source files in the directory.
    If file_type is specified, filter by extension (e.g., 'py').
    __init__.py 등 특정 파일은 제외한다.
    """

    pattern = f"**/*.{file_type}" if file_type else "**/*"
    files = [f for f in glob.glob(os.path.join(directory, pattern), recursive=True) if os.path.isfile(f)]
    # __init__.py 등 제외
    files = [f for f in files if os.path.basename(f) != "__init__.py"]
    return files

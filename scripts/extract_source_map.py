#!/usr/bin/env python3
"""
Extract source location map from consensus-specs markdown files.

Scans markdown files for Python code blocks and table rows, mapping each
spec item (function, class, constant, type) to its file path and line numbers.
This enables the frontend to link directly to the GitHub source.
"""

import ast
import json
import os
import re
import sys


# Regex for table rows containing constant/type names
# Matches: | `NAME` | ... | or | `Name` | ... |
TABLE_ROW_RE = re.compile(r'^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|')

# Pattern for ALL_CAPS_WITH_UNDERSCORES constant names
CONSTANT_NAME_RE = re.compile(r'^[A-Z][A-Z0-9_]+$')

# Pattern for PascalCase type names
PASCAL_CASE_RE = re.compile(r'^[A-Z][a-zA-Z0-9]+$')


def find_fork_directories(repo_root):
    """
    Find all fork/feature directories containing markdown spec files.

    Returns a list of (fork_name, directory_path) tuples.
    """
    specs_dir = os.path.join(repo_root, "specs")
    if not os.path.isdir(specs_dir):
        return []

    results = []

    # Main fork directories: specs/{fork}/
    for entry in sorted(os.listdir(specs_dir)):
        entry_path = os.path.join(specs_dir, entry)
        if os.path.isdir(entry_path) and not entry.startswith('_') and not entry.startswith('.'):
            results.append((entry, entry_path))

    # Feature directories: specs/_features/{eip}/
    features_dir = os.path.join(specs_dir, "_features")
    if os.path.isdir(features_dir):
        for entry in sorted(os.listdir(features_dir)):
            entry_path = os.path.join(features_dir, entry)
            if os.path.isdir(entry_path) and not entry.startswith('.'):
                results.append((entry, entry_path))

    return results


def find_markdown_files(directory):
    """Find all .md files recursively in a directory."""
    md_files = []
    for dirpath, dirnames, filenames in os.walk(directory):
        dirnames.sort()
        filenames.sort()
        for filename in filenames:
            if filename.endswith('.md'):
                md_files.append(os.path.join(dirpath, filename))
    return md_files


def extract_from_file(filepath, repo_root):
    """
    Extract spec items from a single markdown file.

    Returns a list of (item_name, start_line, end_line) tuples.
    Line numbers are 1-indexed.
    """
    with open(filepath, 'r') as f:
        lines = f.readlines()

    items = []
    in_python_block = False
    code_block_start = 0  # 1-indexed line of the ```python marker
    code_lines = []

    for line_num_0, line in enumerate(lines):
        line_num = line_num_0 + 1  # 1-indexed

        stripped = line.rstrip()

        # Detect start of Python code block
        if not in_python_block and stripped.startswith('```python'):
            in_python_block = True
            code_block_start = line_num
            code_lines = []
            continue

        # Detect end of code block
        if in_python_block and stripped == '```':
            in_python_block = False

            # Parse the accumulated code
            code_text = ''.join(code_lines)
            if code_text.strip():
                try:
                    tree = ast.parse(code_text)
                except SyntaxError:
                    continue

                for node in ast.iter_child_nodes(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        # AST line numbers are 1-indexed within the code block
                        # Markdown line = code_block_start + ast_lineno
                        # (code_block_start is the ```python line,
                        #  so first code line is code_block_start + 1,
                        #  and ast lineno 1 = code_block_start + 1)
                        md_start = code_block_start + node.lineno
                        md_end = code_block_start + node.end_lineno
                        items.append((node.name, md_start, md_end))

            code_lines = []
            continue

        # Accumulate code lines
        if in_python_block:
            code_lines.append(line)
            continue

        # Check for table rows with constant/type names (outside code blocks)
        match = TABLE_ROW_RE.match(stripped)
        if match:
            name = match.group(1)
            # Only include names that look like constants or types
            if CONSTANT_NAME_RE.match(name) or PASCAL_CASE_RE.match(name):
                items.append((name, line_num, line_num))

    return items


def build_source_map(repo_root):
    """
    Build the complete source map from the consensus-specs repository.

    Returns a dict: { items: { name: { fork: { file, start, end } } } }
    """
    source_map = {}

    fork_dirs = find_fork_directories(repo_root)
    if not fork_dirs:
        print(f"Warning: No fork directories found in {repo_root}/specs/", file=sys.stderr)
        return {"items": source_map}

    for fork_name, fork_dir in fork_dirs:
        md_files = find_markdown_files(fork_dir)

        for md_file in md_files:
            # File path relative to repo root
            rel_path = os.path.relpath(md_file, repo_root)

            items = extract_from_file(md_file, repo_root)

            for item_name, start_line, end_line in items:
                if item_name not in source_map:
                    source_map[item_name] = {}

                source_map[item_name][fork_name] = {
                    "file": rel_path,
                    "start": start_line,
                    "end": end_line,
                }

    return {"items": source_map}


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: extract_source_map.py <consensus-specs-dir> [output-file]",
            file=sys.stderr,
        )
        sys.exit(1)

    repo_root = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.isdir(repo_root):
        print(f"Error: Directory not found: {repo_root}", file=sys.stderr)
        sys.exit(1)

    print(f"Extracting source map from: {repo_root}", file=sys.stderr)

    result = build_source_map(repo_root)
    item_count = len(result["items"])
    print(f"Extracted {item_count} items", file=sys.stderr)

    result_json = json.dumps(result)

    if output_file:
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        with open(output_file, "w") as f:
            f.write(result_json)
        print(f"Written to: {output_file}", file=sys.stderr)
    else:
        print(result_json)


if __name__ == "__main__":
    main()

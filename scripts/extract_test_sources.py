#!/usr/bin/env python3
"""
Extract test function source code from consensus-specs test files.

Outputs a JSON file mapping test paths to their Python source code,
enabling the frontend to display test functions alongside test data.
"""

import ast
import json
import os
import sys


def find_test_root(repo_root):
    """Find the test root directory in the consensus-specs repo."""
    candidates = [
        os.path.join(repo_root, "tests", "core", "pyspec", "eth_consensus_specs", "test"),
        os.path.join(repo_root, "tests", "core", "pyspec", "eth2spec", "test"),
    ]
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return None


def extract_test_functions(test_root):
    """
    Extract all test function source code from test files.

    Returns:
        functions: dict mapping "rel_dir/module_name/function_name" -> source code
        by_name: dict mapping "function_name" -> list of keys in functions
    """
    functions = {}
    by_name = {}

    for dirpath, dirnames, filenames in os.walk(test_root):
        # Sort for deterministic output
        dirnames.sort()
        filenames.sort()

        for filename in filenames:
            if not filename.startswith("test_") or not filename.endswith(".py"):
                continue

            filepath = os.path.join(dirpath, filename)
            rel_dir = os.path.relpath(dirpath, test_root)
            module_name = filename[:-3]  # remove .py

            # Read source
            with open(filepath, "r") as f:
                source = f.read()
                lines = source.splitlines()

            # Parse AST
            try:
                tree = ast.parse(source)
            except SyntaxError:
                print(f"Warning: Failed to parse {filepath}", file=sys.stderr)
                continue

            # Extract top-level test functions only
            for node in ast.iter_child_nodes(tree):
                if not isinstance(node, ast.FunctionDef):
                    continue
                if not node.name.startswith("test_"):
                    continue

                # Get decorator start line (or function start if no decorators)
                if node.decorator_list:
                    start_line = node.decorator_list[0].lineno
                else:
                    start_line = node.lineno
                end_line = node.end_lineno

                # Extract source (convert from 1-indexed to 0-indexed)
                func_source = "\n".join(lines[start_line - 1 : end_line])

                # Build key: rel_dir/module_name/function_name
                if rel_dir == ".":
                    key = f"{module_name}/{node.name}"
                else:
                    key = f"{rel_dir}/{module_name}/{node.name}"

                functions[key] = func_source

                # Build reverse index by function name
                if node.name not in by_name:
                    by_name[node.name] = []
                by_name[node.name].append(key)

    return functions, by_name


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: extract_test_sources.py <consensus-specs-dir> [output-file]",
            file=sys.stderr,
        )
        sys.exit(1)

    repo_root = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    test_root = find_test_root(repo_root)
    if not test_root:
        print(f"Error: Could not find test directory in {repo_root}", file=sys.stderr)
        sys.exit(1)

    print(f"Extracting test sources from: {test_root}", file=sys.stderr)

    functions, by_name = extract_test_functions(test_root)
    print(f"Extracted {len(functions)} test functions", file=sys.stderr)

    result = json.dumps({"functions": functions, "by_name": by_name})

    if output_file:
        with open(output_file, "w") as f:
            f.write(result)
        print(f"Written to: {output_file}", file=sys.stderr)
    else:
        print(result)


if __name__ == "__main__":
    main()

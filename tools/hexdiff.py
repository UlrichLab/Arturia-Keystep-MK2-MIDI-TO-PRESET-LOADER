#!/usr/bin/env python3
"""Byte-level diff for two binary files, formatted as a hexdump with offsets."""
import argparse
import sys

ROW_WIDTH = 16


def format_row(offset, chunk_a, chunk_b):
    hex_a, hex_b, ascii_a = [], [], []
    row_differs = False
    for i in range(ROW_WIDTH):
        a = chunk_a[i] if i < len(chunk_a) else None
        b = chunk_b[i] if i < len(chunk_b) else None
        if a is None and b is None:
            hex_a.append("  ")
            hex_b.append("  ")
            ascii_a.append(" ")
            continue
        differs = a != b
        row_differs = row_differs or differs
        a_str = f"{a:02X}" if a is not None else "--"
        b_str = f"{b:02X}" if b is not None else "--"
        if differs:
            hex_a.append(f"[{a_str}]" if a is not None else " -- ")
            hex_b.append(f"[{b_str}]" if b is not None else " -- ")
        else:
            hex_a.append(f" {a_str} ")
            hex_b.append(f" {b_str} ")
        ascii_a.append(chr(a) if a is not None and 32 <= a < 127 else ".")
    line_a = f"{offset:08X}  {''.join(hex_a)}  {''.join(ascii_a)}"
    line_b = f"{'':8}  {''.join(hex_b)}"
    return row_differs, line_a, line_b


def diff_files(path_a, path_b, context, full):
    data_a = path_a.read_bytes()
    data_b = path_b.read_bytes()
    length = max(len(data_a), len(data_b))
    rows = []
    for offset in range(0, length, ROW_WIDTH):
        chunk_a = data_a[offset:offset + ROW_WIDTH]
        chunk_b = data_b[offset:offset + ROW_WIDTH]
        rows.append(format_row(offset, chunk_a, chunk_b))

    diff_count = sum(1 for differs, _, _ in rows if differs)

    print(f"A: {path_a} ({len(data_a)} bytes)")
    print(f"B: {path_b} ({len(data_b)} bytes)")
    print(f"{diff_count} differing row(s) of {len(rows)}\n")

    if diff_count == 0 and len(data_a) == len(data_b):
        print("Files are identical.")
        return 0

    if full:
        indices_to_print = set(range(len(rows)))
    else:
        indices_to_print = set()
        for i, (differs, _, _) in enumerate(rows):
            if differs:
                for j in range(max(0, i - context), min(len(rows), i + context + 1)):
                    indices_to_print.add(j)

    last_printed = -2
    for i in sorted(indices_to_print):
        if i != last_printed + 1:
            print("...")
        differs, line_a, line_b = rows[i]
        marker = "*" if differs else " "
        print(f"{marker} {line_a}")
        if differs:
            print(f"{marker} {line_b}")
        last_printed = i

    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file_a", type=argparse.FileType("rb"))
    parser.add_argument("file_b", type=argparse.FileType("rb"))
    parser.add_argument("--context", type=int, default=1,
                         help="rows of unchanged context around each diff (default: 1)")
    parser.add_argument("--full", action="store_true",
                         help="print the entire file instead of just diff context")
    args = parser.parse_args()

    import pathlib
    path_a = pathlib.Path(args.file_a.name)
    path_b = pathlib.Path(args.file_b.name)
    args.file_a.close()
    args.file_b.close()

    return diff_files(path_a, path_b, args.context, args.full)


if __name__ == "__main__":
    sys.exit(main())

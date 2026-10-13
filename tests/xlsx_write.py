"""Minimal xlsx writer for bet-tracker fixtures (stdlib; no openpyxl)."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
_CT = "http://schemas.openxmlformats.org/package/2006/content-types"


def _col_letters(idx: int) -> str:
    n = idx + 1
    letters = []
    while n:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def _cell_xml(col: int, row: int, value: Any, shared: list[str]) -> str:
    ref = f"{_col_letters(col)}{row}"
    if value is None or value == "":
        return f'<c r="{ref}"/>'
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, int) and not isinstance(value, bool):
        return f'<c r="{ref}" t="n"><v>{value}</v></c>'
    if isinstance(value, float):
        return f'<c r="{ref}" t="n"><v>{value}</v></c>'
    text = str(value)
    shared.append(text)
    return f'<c r="{ref}" t="s"><v>{len(shared) - 1}</v></c>'


def write_xlsx(path: Path | str, sheets: dict[str, list[list[Any]]]) -> Path:
    """Write ``{sheet_name: [header_row, *data_rows]}`` to ``path``."""
    dest = Path(path)
    shared: list[str] = []
    sheet_xml: list[tuple[str, str]] = []
    for name, rows in sheets.items():
        lines = [
            f'<worksheet xmlns="{_NS}">',
            "<sheetData>",
        ]
        for r_i, row in enumerate(rows, start=1):
            cells = "".join(_cell_xml(c_i, r_i, val, shared) for c_i, val in enumerate(row))
            lines.append(f'<row r="{r_i}">{cells}</row>')
        lines.extend(["</sheetData>", "</worksheet>"])
        sheet_xml.append((name, "\n".join(lines)))

    sst_items = "".join(f"<si><t>{escape(s)}</t></si>" for s in shared)
    sst = (
        f'<sst xmlns="{_NS}" count="{len(shared)}" uniqueCount="{len(shared)}">'
        f"{sst_items}</sst>"
    )
    styles = (
        f'<styleSheet xmlns="{_NS}">'
        "<fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
        "<fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>"
        "<borders count=\"1\"><border/></borders>"
        "<cellStyleXfs count=\"1\"><xf/></cellStyleXfs>"
        "<cellXfs count=\"1\"><xf/></cellXfs>"
        "</styleSheet>"
    )
    sheets_el = []
    rels_el = []
    overrides = [
        (
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        ),
        (
            '<Override PartName="/xl/sharedStrings.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        ),
        (
            '<Override PartName="/xl/styles.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        ),
    ]
    for i, (name, _xml) in enumerate(sheet_xml, start=1):
        sheets_el.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
        rels_el.append(
            f'<Relationship Id="rId{i}" '
            f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    n = len(sheet_xml)
    rels_el.append(
        f'<Relationship Id="rId{n + 1}" '
        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
        f'Target="sharedStrings.xml"/>'
    )
    rels_el.append(
        f'<Relationship Id="rId{n + 2}" '
        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        f'Target="styles.xml"/>'
    )
    workbook = (
        f'<workbook xmlns="{_NS}" xmlns:r="{_REL}">'
        f"<sheets>{''.join(sheets_el)}</sheets>"
        "</workbook>"
    )
    wb_rels = f'<Relationships xmlns="{_PKG}">{"".join(rels_el)}</Relationships>'
    content_types = (
        f'<Types xmlns="{_CT}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{''.join(overrides)}"
        "</Types>"
    )
    root_rels = (
        f'<Relationships xmlns="{_PKG}">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        zf.writestr("xl/sharedStrings.xml", sst)
        zf.writestr("xl/styles.xml", styles)
        for i, (_name, xml) in enumerate(sheet_xml, start=1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", xml)
    return dest

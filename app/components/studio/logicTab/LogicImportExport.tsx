import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type * as XLSX from "xlsx";
import type { Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { RuleStatus } from "../../../lib/ruleStatus";
import {
  applyLogicImport,
  decodeSpreadsheetText,
  exportWorkbook,
  importToastMessage,
  isBinarySpreadsheet,
  type PlainWorkbook,
  type SheetContext,
} from "../../../lib/logicSheets";
import type { BuilderCategory } from "../../builder/stepProps";
import { useQzToast } from "../../qz-toast";
import type { LogicUndoPush } from "./useLogicUndo";
import { IMPORT_COPY, IO_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — Import | Export (mock headRight .iox, buildWorkbook,
// importFile, toastImp; handoff D16 / D16-template). Shown in the Table view
// of either style, in the header's slot.
//
//   Export  the logicSheets models of the LATEST doc → quiz-logic.xlsx as a
//           normal Blob download. It is also the template: a quiz with no
//           rules still gets the headers, the id columns and one example
//           row. "Export in progress" lives in React state (B37).
//   Import  a hidden file input (.xlsx, .xls, .csv), 1 MB cap, 2,000 rows a
//           sheet, values only. CSV bytes are decoded here (UTF-8, then
//           Windows-1252; B26). applyLogicImport runs against the latest
//           doc, ONE commit, one Undo entry whose inverse restores only what
//           the import touched (D7).
//
// The library is SheetJS CE 0.20.3 from the official cdn.sheetjs.com
// tarball (package.json pins the URL), loaded with a dynamic import() on
// click so Vite emits a lazy chunk. Never the npm xlsx 0.18.5 build
// (CVE-2023-30533, CVE-2024-22363). Nothing else imports it; logicSheets.ts
// works on a plain shape, and this file is the only adapter.
// ════════════════════════════════════════════════════════════════════════════

type XlsxLib = typeof XLSX;

let xlsxLoader: Promise<XlsxLib> | null = null;

/** The lazy chunk. A failed load clears the cached promise so the next
 *  click retries (a tab left open across a deploy loses the old chunk). */
function loadXlsx(): Promise<XlsxLib> {
  if (!xlsxLoader) {
    xlsxLoader = import("xlsx").catch((e: unknown) => {
      xlsxLoader = null;
      throw e;
    });
  }
  return xlsxLoader;
}

export const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Plain workbook → xlsx bytes (text cells stay text; widths; the custom
 *  question-order property). */
export function workbookToXlsx(X: XlsxLib, plain: PlainWorkbook): ArrayBuffer {
  const wb = X.utils.book_new();
  for (const sh of plain.sheets) {
    const ws = X.utils.aoa_to_sheet(sh.rows);
    if (sh.widths) ws["!cols"] = sh.widths.map((wch) => ({ wch }));
    X.utils.book_append_sheet(wb, ws, sh.name);
  }
  if (plain.props) wb.Custprops = { ...plain.props };
  return X.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** File bytes → workbook: xlsx / xls / UTF-16 as binary, everything else
 *  decoded as text first (B26). Values only, row-capped. */
export function readSpreadsheet(X: XlsxLib, bytes: Uint8Array): XLSX.WorkBook {
  const opts = { sheetRows: MAX_ROWS + 1, cellFormula: false, cellHTML: false, cellStyles: false };
  if (isBinarySpreadsheet(bytes)) return X.read(bytes, { ...opts, type: "array" });
  return X.read(decodeSpreadsheetText(bytes), { ...opts, type: "string", raw: true });
}

/** Workbook → the plain shape logicSheets reads (rows as arrays, never
 *  header-keyed objects). */
export function workbookToPlain(X: XlsxLib, wb: XLSX.WorkBook): PlainWorkbook {
  const props: Record<string, string> = {};
  const custom = (wb as { Custprops?: Record<string, unknown> }).Custprops;
  if (custom) {
    for (const [k, v] of Object.entries(custom)) if (typeof v === "string") props[k] = v;
  }
  return {
    props,
    sheets: wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const rows = ws
        ? X.utils.sheet_to_json<Array<string | number>>(ws, { header: 1, defval: "", raw: false, blankrows: true })
        : [];
      return { name, rows: rows.map((r) => r.map((c) => (typeof c === "number" ? c : String(c ?? "")))) };
    }),
  };
}

function download(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The card's Undo run, as this control uses it (useLogicUndo). */
export type ImportUndo = {
  push: (p: LogicUndoPush<Quiz>) => void;
  isLive: () => boolean;
};

export type LogicImportExportProps = {
  doc: Quiz;
  style: LogicStyle;
  questions: OrderedQuestion[];
  categories: readonly BuilderCategory[];
  recommendations: readonly BuilderCategory[];
  /** Absent = read-only (Import disabled). */
  commit?: (doc: Quiz) => void;
  getLatestDoc: () => Quiz;
  undo?: ImportUndo;
  /** Collection id → title (Narrows "Collection: …" values). */
  collectionTitles?: ReadonlyMap<string, string>;
  statuses?: ReadonlyMap<string, RuleStatus>;
};

const IMPORT_TOAST_MS = 7000;

export function LogicImportExport({
  style,
  categories,
  recommendations,
  commit,
  getLatestDoc,
  undo,
  collectionTitles,
}: LogicImportExportProps) {
  const toast = useQzToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const ctx = useCallback(
    (): SheetContext => ({
      style,
      categories,
      recommendations,
      ...(collectionTitles ? { collectionTitles } : {}),
    }),
    [style, categories, recommendations, collectionTitles],
  );

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let X: XlsxLib;
      try {
        X = await loadXlsx();
      } catch {
        toast(IMPORT_COPY.writerFailed);
        return;
      }
      try {
        const { workbook, example } = exportWorkbook(getLatestDoc(), ctx());
        download(workbookToXlsx(X, workbook), IMPORT_COPY.fileName);
        toast(example ? IMPORT_COPY.exportedExample : IMPORT_COPY.exported);
      } catch {
        toast(IMPORT_COPY.exportFailed);
      }
    } finally {
      setExporting(false);
    }
  };

  const openChooser = () => {
    const input = fileRef.current;
    if (!input || importing || !commit) return;
    // Cleared first so choosing the same file again still fires.
    input.value = "";
    input.click();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file || !commit) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast(IMPORT_COPY.tooBig);
      return;
    }
    setImporting(true);
    try {
      let X: XlsxLib;
      try {
        X = await loadXlsx();
      } catch {
        toast(IMPORT_COPY.readerFailed);
        return;
      }
      let plain: PlainWorkbook;
      try {
        plain = workbookToPlain(X, readSpreadsheet(X, new Uint8Array(await file.arrayBuffer())));
      } catch {
        toast(IMPORT_COPY.unreadable);
        return;
      }
      // Reading and loading were async: apply against the newest doc.
      const res = applyLogicImport(getLatestDoc(), plain, ctx());
      if (res.error) {
        toast(res.error);
        return;
      }
      const message = importToastMessage(res);
      const inverse = res.inverse;
      if (res.changes === 0 || res.doc === getLatestDoc() || !inverse) {
        toast(message);
        return;
      }
      commit(res.doc);
      // Its own Undo slot (mock IMP_UNDO): it replaces whatever toast is up
      // and never joins a rules run.
      if (undo)
        undo.push({
          message,
          inverse,
          kind: "import",
          duration: IMPORT_TOAST_MS,
          staleMessage: IMPORT_COPY.undoStale,
        });
      else toast(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <span className="qz-lg-iox" data-testid="logic-io">
      <button
        type="button"
        title={IO_COPY.importTip}
        disabled={!commit || importing}
        aria-busy={importing || undefined}
        onClick={openChooser}
        data-io="import"
      >
        {IO_COPY.import}
      </button>
      <button
        type="button"
        title={IO_COPY.exportTip}
        disabled={exporting}
        aria-busy={exporting || undefined}
        onClick={() => void onExport()}
        data-io="export"
      >
        {IO_COPY.export}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid="logic-io-file"
        onChange={(e) => void onFile(e)}
      />
    </span>
  );
}

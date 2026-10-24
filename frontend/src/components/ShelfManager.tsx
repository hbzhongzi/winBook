import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryEntry } from "../utils/library";
import { entryCategory, formatRelativeTime, progressLabel } from "../utils/library";

type Props = {
  /** 当前书架全量条目（App 传入，已按 lastOpen 倒序） */
  entries: LibraryEntry[];
  /** 移除所选（批量） */
  onRemove: (paths: string[]) => void;
  /** 清空全部（已过二次确认） */
  onClearAll: () => void;
  /** 关闭对话框（Esc / 遮罩 / 取消） */
  onClose: () => void;
};

/**
 * 书架管理对话框（v0.2.8 F25/F26）。
 * 面板一：自选清除列表（复选框 + 全选 + 移除所选 / 清空全部…）
 * 面板二：清空全部二次确认（显式条数 + 不可恢复提示）
 * 取消路径三条（Esc / 遮罩 / 取消）均不改动数据。
 */
export default function ShelfManager({ entries, onRemove, onClearAll, onClose }: Props) {
  const [panel, setPanel] = useState<"list" | "confirm">("list");
  const [selected, setSelected] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 每次打开重置为面板一、清空选择（条目变化亦同步）
  useEffect(() => {
    setPanel("list");
    setSelected([]);
  }, [entries]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Esc 只关最上层（本对话框）：捕获阶段拦截，避免同时关掉身后的设置面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allChecked = entries.length > 0 && selected.length === entries.length;

  const toggle = useCallback((path: string, checked: boolean) => {
    setSelected((prev) => {
      const set = new Set(prev);
      if (checked) set.add(path);
      else set.delete(path);
      // 按条目顺序输出，便于上层批量处理与展示
      return entries.map((e) => e.path).filter((p) => set.has(p));
    });
  }, [entries]);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? entries.map((e) => e.path) : []);
    },
    [entries]
  );

  const doRemove = useCallback(() => {
    if (selected.length === 0) return;
    onRemove(selected);
    onClose();
  }, [onRemove, onClose, selected]);

  const doClearAll = useCallback(() => {
    onClearAll();
    setPanel("list");
    onClose();
  }, [onClearAll, onClose]);

  const count = entries.length;
  const n = selected.length;

  return (
    <div
      className="modal-mask shelf-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal shelf-manager"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="清空书架记录"
      >
        <header className="settings-head">
          <h2 className="modal-title">
            {panel === "confirm" ? "确认清空" : "清空书架记录"}
          </h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="关闭"
          >
            &#10005;
          </button>
        </header>

        {/* ===== 面板一：自选清除 ===== */}
        <div className="shelf-mgr-body" hidden={panel !== "list"}>
          <div className="shelf-mgr-bar">
            <label className="clear-all">
              <input
                type="checkbox"
                checked={allChecked}
                disabled={count === 0}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              全选
            </label>
            <span className="clear-sel-info">
              已选 {n} / {count} 条
            </span>
          </div>

          <div className="clear-list">
            {entries.map((entry) => (
              <label className="clear-item" key={entry.path} title={entry.path}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(entry.path)}
                  onChange={(e) => toggle(entry.path, e.target.checked)}
                />
                <span className={"ci-cover c-" + entry.format}>
                  {entry.name.slice(0, 1)}
                </span>
                <span className="ci-body">
                  <span className="ci-name">{entry.name}</span>
                  <span className="ci-meta">
                    <span className="ci-cat">{entryCategory(entry)}</span>
                    {formatRelativeTime(entry.lastOpen)} · {progressLabel(entry)}
                  </span>
                </span>
              </label>
            ))}
            {count === 0 && <div className="clear-empty">书架为空，没有可清除的记录。</div>}
          </div>

          <footer className="shelf-mgr-foot">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={n === 0}
              onClick={doRemove}
            >
              移除所选（{n}）
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={count === 0}
              onClick={() => setPanel("confirm")}
            >
              清空全部…
            </button>
          </footer>
        </div>

        {/* ===== 面板二：清空全部二次确认 ===== */}
        <div className="shelf-mgr-body confirm-body" hidden={panel !== "confirm"}>
          <div className="confirm-box">
            <p className="confirm-title">确认清空全部阅读记录？</p>
            <p className="confirm-desc">
              将删除全部 <b>{count}</b> 条阅读记录与对应阅读位置。
            </p>
            <p className="confirm-note">此操作不可恢复，图书文件本身不受影响。</p>
          </div>
          <footer className="shelf-mgr-foot">
            <button type="button" className="btn" onClick={() => setPanel("list")}>
              返回
            </button>
            <button type="button" className="btn btn-danger-solid" onClick={doClearAll}>
              确认清空
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

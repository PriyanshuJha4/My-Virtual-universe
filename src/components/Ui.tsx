import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/* Small in-app replacements for window.confirm / window.prompt.
   (window.prompt does not exist in Electron, and native confirm can steal keyboard focus on Windows.) */

type ConfirmOptions = { title?: string; confirmLabel?: string; danger?: boolean };
type PromptOptions = { title: string; label?: string; initial?: string; confirmLabel?: string; placeholder?: string };

interface UiApi {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  toast: (message: string, ms?: number) => void;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

type DialogState =
  | { kind: "confirm"; message: string; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (v: string | null) => void };

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) =>
    new Promise<boolean>(resolve => setDialog({ kind: "confirm", message, options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) =>
    new Promise<string | null>(resolve => setDialog({ kind: "prompt", options, resolve })), []);
  const toast = useCallback((message: string, ms = 3200) => {
    setToastText(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(""), ms);
  }, []);

  const api = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <UiContext.Provider value={api}>
      {children}
      {dialog && <DialogView state={dialog} close={() => setDialog(null)} />}
      {toastText && <div className="toast" role="status"><span className="status-dot" />{toastText}</div>}
    </UiContext.Provider>
  );
}

function DialogView({ state, close }: { state: DialogState; close: () => void }) {
  const [value, setValue] = useState(state.kind === "prompt" ? state.options.initial ?? "" : "");

  function finish(result: boolean) {
    if (state.kind === "confirm") state.resolve(result);
    else state.resolve(result && value.trim() ? value.trim() : null);
    close();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") finish(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isPrompt = state.kind === "prompt";
  const title = isPrompt ? state.options.title : state.options.title ?? "Are you sure?";
  const confirmLabel = (isPrompt ? state.options.confirmLabel : state.options.confirmLabel) ?? (isPrompt ? "Save" : "Confirm");
  const danger = !isPrompt && state.options.danger;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) finish(false); }}>
      <form className="modal modal-small" role="dialog" aria-modal="true" aria-label={title} onSubmit={e => { e.preventDefault(); finish(true); }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={() => finish(false)} aria-label="Close"><X size={18} /></button>
        </div>
        {state.kind === "confirm"
          ? <p className="modal-text">{state.message}</p>
          : <label className="field-label">{state.options.label ?? "NAME"}
              <input autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder={state.options.placeholder} maxLength={80} />
            </label>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => finish(false)}>Cancel</button>
          <button type="submit" className={danger ? "danger-button" : "primary-button"} autoFocus={!isPrompt} disabled={isPrompt && !value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name, imageUrl, size = "md" }: { name: string; imageUrl?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(s => s[0] || "").join("").toUpperCase() || "?";
  return (
    <div className={`avatar avatar-${size}`}>
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : initials}
    </div>
  );
}

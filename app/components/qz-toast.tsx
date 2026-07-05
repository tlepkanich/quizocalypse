import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* Design-system-V2 §7.5 — Toast: non-blocking transient confirmations
   ("Saved", "Added", "Moved"). Bottom-center ink pill, 13px/500 white text,
   auto-dismiss 2.4s, enters with fade + 16px rise. NEVER stacks — a new
   toast replaces the current one (queue of 1). Not clickable, no actions:
   if an action is needed, it isn't a toast. */

const AUTO_DISMISS_MS = 2400;

/** Pure queue-of-1 reducer semantics, exported for tests: a new message
    always replaces the current one and restarts the clock. */
export function nextToastState(
  _current: { id: number; message: string } | null,
  message: string,
  id: number,
): { id: number; message: string } {
  return { id, message };
}

const ToastContext = createContext<(message: string) => void>(() => {});

export function useQzToast(): (message: string) => void {
  return useContext(ToastContext);
}

export function QzToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setReady(true), []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((message: string) => {
    counter.current += 1;
    const id = counter.current;
    setToast((current) => nextToastState(current, message, id));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, AUTO_DISMISS_MS);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {ready && toast
        ? createPortal(
            <div className="qz-toast" role="status" aria-live="polite" key={toast.id}>
              {toast.message}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

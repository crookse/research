"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// How many modals are open. The page stays locked until the last one closes,
// so closing an inner modal doesn't unlock the page under an outer one.
// Pair with `html { scrollbar-gutter: stable; }` so nothing shifts.
let openModals = 0;

function lockPageScroll() {
  if (openModals++ === 0) document.documentElement.style.overflow = "hidden";
}

function unlockPageScroll() {
  if (--openModals === 0) document.documentElement.style.overflow = "";
}

/**
 * The item a modal shows (the entry being edited, say), kept through the
 * modal's exit animation: `close` starts the exit, and the item is cleared
 * once it has finished. Pass `open` and `onExited` to the modal.
 */
export function useModalItem<T>() {
  const [item, setItem] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  return {
    item,
    open,
    show: (next: T) => {
      setItem(next);
      setOpen(true);
    },
    close: () => setOpen(false),
    onExited: () => setItem(null),
  };
}

/**
 * A modal on the native `<dialog>`: focus trapping, Esc to close and an
 * inert page come with it. A header (title and ✕), a body that scrolls, and
 * an optional footer of actions. Modals stack; Esc closes only the topmost.
 * Closing animates out; the last content stays until then, and `onExited`
 * fires after.
 */
export function Modal({
  open,
  title,
  onClose,
  footer,
  children,
  width = "24rem",
  onExited,
  closeButton = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Action buttons; see FooterActions for the usual layout. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Any CSS length; capped to the screen. */
  width?: string;
  onExited?: () => void;
  /** The ✕ by the title. Leave it off when the footer's buttons are the way out; Esc still closes. */
  closeButton?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Closing starts when `open` turns false and ends once the exit animation
  // has run. Reopening part way through just animates back in.
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }
  const shown = open || closing;

  // While closing, show what was there before: callers often clear the
  // content in the same update that closes the modal.
  const [content, setContent] = useState({ title, children, footer });
  if (
    open &&
    (content.title !== title || content.children !== children || content.footer !== footer)
  )
    setContent({ title, children, footer });
  const current = open ? { title, children, footer } : content;

  useEffect(() => {
    const el = dialog.current;
    if (!el || !shown) return;
    if (!el.open) {
      el.showModal();
      // showModal focuses the first button (the ✕), which would flash a
      // focus ring. Focus the dialog instead; Tab still reaches the ✕ first.
      el.focus();
    }
    lockPageScroll();
    return () => {
      unlockPageScroll();
      if (el.open) el.close();
    };
  }, [shown]);

  const exited = useRef(onExited);
  useEffect(() => {
    exited.current = onExited;
  });

  useEffect(() => {
    const el = dialog.current;
    if (!el || !closing) return;
    const done = () => {
      setClosing(false);
      exited.current?.();
    };
    // Wait for the fade; the timer covers reduced motion and a transition
    // that never reports back.
    const onEnd = (e: TransitionEvent) =>
      e.target === el && e.propertyName === "opacity" && done();
    el.addEventListener("transitionend", onEnd);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(done, reduced ? 0 : 300);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }, [closing]);

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-closing={closing || undefined}
      // Nothing inside responds while it animates out.
      inert={closing}
      // Esc would close at once; close the animated way instead. React passes
      // a nested dialog's events up, so only react to our own.
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      // If the browser closes it anyway (Esc twice). Ignore a stale close
      // event from before a reopen, or one we caused.
      onClose={(e) =>
        e.target === e.currentTarget && !e.currentTarget.open && open && onClose()
      }
      style={{ width: `min(${width}, calc(100vw - 2rem))` }}
      // open: keeps the closed dialog's display: none. starting: is the frame
      // it animates in from; data-closing: reverses it on the way out.
      className="m-auto max-h-[80dvh] rounded-xl border border-border bg-popover p-0 text-left text-popover-foreground shadow-xl outline-none transition-[opacity,translate,scale] duration-200 ease-out backdrop:bg-black/40 backdrop:transition-[background-color] backdrop:duration-200 open:flex open:flex-col starting:open:translate-y-2 starting:open:scale-[0.97] starting:open:opacity-0 starting:open:backdrop:bg-black/0 data-closing:translate-y-2 data-closing:scale-[0.97] data-closing:opacity-0 data-closing:backdrop:bg-black/0 motion-reduce:transition-none motion-reduce:backdrop:transition-none sm:max-h-[calc(100dvh-2rem)]"
    >
      {shown && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-5 pt-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {current.title}
            </h2>
            {closeButton && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
          {/* Body: the only part that scrolls, never chaining to the page.
              flex-auto, not flex-1: from a 0 basis iOS Safari collapses it. */}
          <div className="min-h-0 flex-auto space-y-3 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">
            {current.children}
          </div>
          {/* Footer */}
          {current.footer && (
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              {current.footer}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}

/**
 * The usual footer: phones get one full-width button per line, primary
 * first; wider screens one row, primary on the right, and a destructive
 * action (spelled out, e.g. "Delete") pushed to the far left.
 */
export function FooterActions({
  primary,
  secondary,
  destructive,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
      {destructive && <div className="sm:mr-auto [&>*]:w-full">{destructive}</div>}
      {secondary}
      {primary}
    </div>
  );
}


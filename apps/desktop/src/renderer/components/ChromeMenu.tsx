import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

export type ChromeMenuItem = {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  run: () => void;
};

type ChromeMenuProps = {
  children: ReactNode;
  items: ChromeMenuItem[];
  label: string;
  title: string;
  triggerRef?: Ref<HTMLButtonElement>;
};

function mergeTriggerRefs(
  externalRef: Ref<HTMLButtonElement> | undefined,
  localRef: Ref<HTMLButtonElement>,
): Ref<HTMLButtonElement> {
  return (node) => {
    for (const ref of [externalRef, localRef]) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    }
  };
}

export function ChromeMenu({ children, items, label, title, triggerRef }: ChromeMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      localTriggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const runItem = (item: ChromeMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    localTriggerRef.current?.focus();
    item.run();
  };

  return (
    <div className="chrome-menu" ref={rootRef}>
      <button
        ref={mergeTriggerRefs(triggerRef, localTriggerRef)}
        type="button"
        className="chrome-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open && (
        <div className="chrome-menu-popover" role="menu" aria-label={title}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => runItem(item)}
            >
              <span>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

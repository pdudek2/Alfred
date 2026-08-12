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
  selectedItemId?: string;
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

export function ChromeMenu({ children, items, label, selectedItemId, title, triggerRef }: ChromeMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const enabledItems = () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
        ) ?? [],
      );
    const focusAt = (index: number) => {
      const menuItems = enabledItems();
      if (menuItems.length === 0) return;
      const nextIndex = (index + menuItems.length) % menuItems.length;
      menuItems.forEach((item, itemIndex) => {
        item.tabIndex = itemIndex === nextIndex ? 0 : -1;
      });
      menuItems[nextIndex]?.focus();
    };
    const frame = requestAnimationFrame(() => {
      const menuItems = enabledItems();
      const selectedIndex = menuItems.findIndex((item) => item.ariaChecked === "true");
      focusAt(selectedIndex >= 0 ? selectedIndex : 0);
    });
    let tabCloseTimer: number | undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        localTriggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        // Let native focus traversal finish before removing the focused menu item.
        tabCloseTimer = window.setTimeout(() => setOpen(false));
        return;
      }
      const menuItems = enabledItems();
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(currentIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(menuItems.length - 1);
      }
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
      window.clearTimeout(tabCloseTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, selectedItemId]);

  const runItem = (item: ChromeMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    localTriggerRef.current?.focus();
    item.run();
  };
  const initialItemId = items.some((item) => item.id === selectedItemId && !item.disabled)
    ? selectedItemId
    : items.find((item) => !item.disabled)?.id;

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
              role={selectedItemId ? "menuitemradio" : "menuitem"}
              aria-checked={selectedItemId ? item.id === selectedItemId : undefined}
              disabled={item.disabled}
              tabIndex={item.id === initialItemId ? 0 : -1}
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

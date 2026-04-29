import { useEffect, useMemo, useRef } from "react";

type ParsedBinding = {
  alt: boolean;
  key: string;
  mod: boolean;
  shift: boolean;
};

type KeyboardShortcutOptions = {
  ignoreEditable?: boolean;
};

const SPECIAL_KEYS: Record<string, string> = {
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  enter: "Enter",
  escape: "Escape",
  slash: "/",
  tab: "Tab",
};

function parseBinding(binding: string): ParsedBinding {
  const parsed: ParsedBinding = {
    alt: false,
    key: "",
    mod: false,
    shift: false,
  };

  for (const part of binding
    .toLowerCase()
    .split("+")
    .map((item) => item.trim())) {
    if (part === "alt" || part === "option") {
      parsed.alt = true;
    } else if (part === "mod") {
      parsed.mod = true;
    } else if (part === "shift") {
      parsed.shift = true;
    } else {
      parsed.key = SPECIAL_KEYS[part] ?? part;
    }
  }

  return parsed;
}

function normalizeKey(key: string): string {
  return key.toLowerCase();
}

function matchesShortcut(event: KeyboardEvent, binding: ParsedBinding): boolean {
  if (normalizeKey(event.key) !== normalizeKey(binding.key)) {
    return false;
  }

  if (binding.mod !== (event.metaKey || event.ctrlKey)) {
    return false;
  }

  if (binding.alt !== event.altKey) {
    return false;
  }

  if (binding.shift !== event.shiftKey) {
    return false;
  }

  return true;
}

export function useKeyboardShortcut(
  binding: string,
  handler: () => void,
  options: KeyboardShortcutOptions = {},
): void {
  const latestHandler = useRef(handler);
  const parsedBinding = useMemo(() => parseBinding(binding), [binding]);
  const latestBinding = useRef(parsedBinding);
  const latestOptions = useRef(options);

  latestHandler.current = handler;
  latestBinding.current = parsedBinding;
  latestOptions.current = options;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, latestBinding.current)) {
        return;
      }

      if (
        latestOptions.current.ignoreEditable &&
        (isEditableElement(event.target) || isEditableElement(document.activeElement))
      ) {
        return;
      }

      event.preventDefault();
      latestHandler.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

import type { Page } from "@playwright/test";

export type ViewportSize = { width: number; height: number };
export type ElementRect = { left: number; right: number; top: number; bottom: number };
export type OverflowSides = { left: number; right: number; top: number; bottom: number };

export type ControlGeometry = {
  label: string;
  rect: ElementRect;
  scrollOwnerId: string | null;
};

export type VerticalScrollOwnerGeometry = {
  id: string;
  label: string;
  overflowY: string;
  rect: ElementRect;
};

export type ControlOverflowViolation = {
  kind: "control" | "scroll-owner";
  label: string;
  sides: OverflowSides;
  reason?: "missing-scroll-owner" | "not-vertical-scroll-owner";
};

export type ControlOverflowInput = {
  viewport: ViewportSize;
  controls: ControlGeometry[];
  scrollOwners: VerticalScrollOwnerGeometry[];
};

export type ControlOverflowProbe = {
  controlSelector: string;
  verticalScrollOwners: Array<{ id: string; label: string; selector: string }>;
};

const GEOMETRY_TOLERANCE = 0.5;

export function controlOverflowEvidence({
  viewport,
  controls,
  scrollOwners,
}: ControlOverflowInput): ControlOverflowViolation[] {
  const ownerIds = new Set(scrollOwners.map((owner) => owner.id));
  const violations: ControlOverflowViolation[] = [];

  for (const control of controls) {
    const missingOwner = control.scrollOwnerId !== null && !ownerIds.has(control.scrollOwnerId);
    const sides = overflowSides(control.rect, viewport, control.scrollOwnerId === null || missingOwner);
    if (hasOverflow(sides) || missingOwner) {
      violations.push({
        kind: "control",
        label: control.label,
        ...(missingOwner ? { reason: "missing-scroll-owner" as const } : {}),
        sides,
      });
    }
  }

  for (const owner of scrollOwners) {
    const sides = overflowSides(owner.rect, viewport, true);
    const intentionalVerticalOwner = owner.overflowY === "auto" || owner.overflowY === "scroll";
    if (hasOverflow(sides) || !intentionalVerticalOwner) {
      violations.push({
        kind: "scroll-owner",
        label: owner.label,
        ...(!intentionalVerticalOwner ? { reason: "not-vertical-scroll-owner" as const } : {}),
        sides,
      });
    }
  }

  return violations;
}

export async function collectControlOverflowEvidence(
  page: Page,
  probe: ControlOverflowProbe,
): Promise<ControlOverflowViolation[]> {
  const geometry = await page.evaluate(({ controlSelector, verticalScrollOwners }) => {
    const owners = verticalScrollOwners.flatMap((owner) => {
      const node = document.querySelector<HTMLElement>(owner.selector);
      if (!node) return [];
      const rect = node.getBoundingClientRect();
      return [{
        id: owner.id,
        label: owner.label,
        node,
        overflowY: getComputedStyle(node).overflowY,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      }];
    });
    const controls = Array.from(document.querySelectorAll<HTMLElement>(controlSelector))
      .filter((control) => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return (
          style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0
          && !control.closest('[aria-hidden="true"], [inert]')
        );
      })
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          label:
            control.getAttribute("aria-label")
            ?? control.getAttribute("title")
            ?? control.textContent?.trim()
            ?? "",
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          scrollOwnerId: owners.find((owner) => owner.node.contains(control))?.id ?? null,
        };
      });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      controls,
      scrollOwners: owners.map(({ node: _node, ...owner }) => owner),
    };
  }, probe);
  return controlOverflowEvidence(geometry);
}

function overflowSides(
  rect: ElementRect,
  viewport: ViewportSize,
  includeVertical: boolean,
): OverflowSides {
  return {
    left: boundedOverflow(-rect.left),
    right: boundedOverflow(rect.right - viewport.width),
    top: includeVertical ? boundedOverflow(-rect.top) : 0,
    bottom: includeVertical ? boundedOverflow(rect.bottom - viewport.height) : 0,
  };
}

function boundedOverflow(value: number): number {
  return value > GEOMETRY_TOLERANCE ? value : 0;
}

function hasOverflow(sides: OverflowSides): boolean {
  return sides.left > 0 || sides.right > 0 || sides.top > 0 || sides.bottom > 0;
}

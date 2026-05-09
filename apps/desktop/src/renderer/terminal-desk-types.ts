export type { WorkMode } from "../shared/layout-ipc";

export type ArrangePointerMode = "move" | "resize";

export type ArrangePreview = {
  tileId: string;
  mode: ArrangePointerMode;
  offsetX: number;
  offsetY: number;
  deltaCol: number;
  deltaRow: number;
};

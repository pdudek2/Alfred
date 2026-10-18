import { trustedIpc } from "./trusted-ipc.js";
import { BrowserWindow, dialog, nativeImage, shell } from "electron";
import path from "node:path";
import {
  workspaceChannels,
  type WorkspaceBindFolderRequest,
  type WorkspaceImageThumbnailResult,
  type WorkspaceQuickLookImageResult,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import { openExternalUrl } from "./external-url.js";
import { openExternalTerminal } from "./external-terminal.js";
import type { WorkspaceStore } from "./workspace-store.js";
import { resolveLinkedImage, resolveWorkspacePathForReveal } from "./workspace-path.js";
import { projectWorktreeRoots } from "./git-worktree.js";
import { scratchWorkspacePath } from "./codex-scratch.js";

type WorkspaceIpcOptions = {
  managedWorktreeRootPath?: string;
  scratchRootPath?: string;
};

export function registerWorkspaceIpc(store: WorkspaceStore, options: WorkspaceIpcOptions = {}): void {
  trustedIpc.handle(
    workspaceChannels.bindFolder,
    async (event, request: WorkspaceBindFolderRequest): Promise<WorkspaceStateSnapshot> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showOpenDialog(window, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });

      if (result.canceled || result.filePaths.length === 0) {
        return store.getWorkspaceState();
      }

      return store.bindWorkspaceToPath({ workspaceId: request.workspaceId, rootPath: result.filePaths[0] ?? "" });
    },
  );
  trustedIpc.handle(workspaceChannels.createFromFolder, async (event): Promise<WorkspaceStateSnapshot> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });

    if (result.canceled || result.filePaths.length === 0) {
      return store.getWorkspaceState();
    }

    return store.createWorkspaceFromPath(result.filePaths[0] ?? "");
  });
  trustedIpc.handle(workspaceChannels.get, (): Promise<WorkspaceStateSnapshot> => store.getWorkspaceState());
  trustedIpc.handle(workspaceChannels.openExternalUrl, (_event, request) => openExternalUrl(request));
  trustedIpc.handle(workspaceChannels.openExternalTerminal, async (_event, request) =>
    openExternalTerminal(request, { allowedRoots: await allowedWorkspaceRoots(store, options) }),
  );
  trustedIpc.handle(workspaceChannels.imageThumbnail, async (_event, request): Promise<WorkspaceImageThumbnailResult> => {
    const result = await resolveLinkedImage(request);
    if (!result.ok) return result;
    try {
      // 640px covers the hover card at 2x. Linux has no system thumbnailer, so it decodes the file.
      const image = process.platform === "linux"
        ? nativeImage.createFromPath(result.resolvedPath).resize({ width: 640 })
        : await nativeImage.createThumbnailFromPath(result.resolvedPath, { width: 640, height: 640 });
      if (image.isEmpty()) return { ok: false, error: "Unsupported image." };
      return { ok: true, dataUrl: image.toDataURL() };
    } catch {
      return { ok: false, error: "Unsupported image." };
    }
  });
  trustedIpc.handle(workspaceChannels.quickLookImage, async (event, request): Promise<WorkspaceQuickLookImageResult> => {
    const result = await resolveLinkedImage(request);
    if (!result.ok) return result;
    // ponytail: Quick Look is macOS only; other systems need their own viewer (shell.openPath) if Alfred ships there.
    if (process.platform !== "darwin") return { ok: false, error: "Quick Look is not available on this system." };
    BrowserWindow.fromWebContents(event.sender)?.previewFile(result.resolvedPath);
    return { ok: true };
  });
  trustedIpc.handle(workspaceChannels.revealPath, async (_event, request) => {
    const result = await resolveWorkspacePathForReveal(request, { allowedRoots: await allowedWorkspaceRoots(store, options) });
    if (result.ok) {
      shell.showItemInFolder(result.resolvedPath);
    }
    return result;
  });
  trustedIpc.handle(
    workspaceChannels.set,
    (_event, request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> => store.setWorkspaceState(request),
  );
}

export async function allowedWorkspaceRoots(store: WorkspaceStore, options: WorkspaceIpcOptions = {}): Promise<string[]> {
  const state = await store.getWorkspaceState();
  const workspaceRoots = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [path.resolve(workspace.rootPath)];
  });
  const worktreeRootSets = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [projectWorktreeRoots(workspace.rootPath, options.managedWorktreeRootPath)];
  });
  const legacyProjectRoots = worktreeRootSets.flatMap((roots) => roots.slice(-1));
  const managedProjectRoots = worktreeRootSets.flatMap((roots) => roots.slice(0, -1));
  const baseRoots = [...workspaceRoots, ...legacyProjectRoots, ...managedProjectRoots];
  const scratchRoot = options.scratchRootPath?.trim();
  const scratchWorkspaceRoots = scratchRoot
    ? [
        scratchWorkspacePath(scratchRoot),
        ...state.workspaces.map((workspace) => scratchWorkspacePath(scratchRoot, workspace.id)),
      ]
    : [];
  const withScratchRoot = (roots: string[]) => [...roots, ...scratchWorkspaceRoots];
  return withScratchRoot(baseRoots);
}

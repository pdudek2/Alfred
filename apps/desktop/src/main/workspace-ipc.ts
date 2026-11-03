import { trustedIpc } from "./trusted-ipc.js";
import { BrowserWindow, dialog, nativeImage, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
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
import { scratchWorkspacePath } from "./codex-scratch.js";
import { worktreesOf } from "./git-work-tree.js";

type WorkspaceIpcOptions = {
  scratchRootPath?: string;
};

export function folderDialogOptions({ workspaces, activeWorkspaceId }: WorkspaceStateSnapshot): OpenDialogOptions {
  const rootPath = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.rootPath;
  // Without defaultPath Electron opens Downloads, and macOS no longer restores the last folder.
  return { properties: ["openDirectory"], ...(rootPath ? { defaultPath: path.dirname(rootPath) } : {}) };
}

export function registerWorkspaceIpc(store: WorkspaceStore, options: WorkspaceIpcOptions = {}): void {
  const pickFolder = async (event: IpcMainInvokeEvent): Promise<string | undefined> => {
    const dialogOptions = folderDialogOptions(await store.getWorkspaceState());
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? undefined : result.filePaths[0];
  };

  trustedIpc.handle(
    workspaceChannels.bindFolder,
    async (event, request: WorkspaceBindFolderRequest): Promise<WorkspaceStateSnapshot> => {
      const rootPath = await pickFolder(event);
      return rootPath
        ? store.bindWorkspaceToPath({ workspaceId: request.workspaceId, rootPath })
        : store.getWorkspaceState();
    },
  );
  trustedIpc.handle(workspaceChannels.createFromFolder, async (event): Promise<WorkspaceStateSnapshot> => {
    const rootPath = await pickFolder(event);
    return rootPath ? store.createWorkspaceFromPath(rootPath) : store.getWorkspaceState();
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
  const projectRoots = state.workspaces.flatMap((workspace) => workspace.rootPath ? [path.resolve(workspace.rootPath)] : []);
  const workspaceRoots = [...projectRoots, ...(await Promise.all(projectRoots.map(worktreesOf))).flat()];
  const scratchRoot = options.scratchRootPath?.trim();
  const scratchWorkspaceRoots = scratchRoot
    ? [
        scratchWorkspacePath(scratchRoot),
        ...state.workspaces.map((workspace) => scratchWorkspacePath(scratchRoot, workspace.id)),
      ]
    : [];
  return [...workspaceRoots, ...scratchWorkspaceRoots];
}

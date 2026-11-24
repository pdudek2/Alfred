import { trustedIpc } from "./trusted-ipc.js";
import { BrowserWindow, dialog, nativeImage, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ATTACHABLE_IMAGE_PATH,
  PAGE_PATH,
  VIEWABLE_FILE_PATH,
  workspaceChannels,
  type WorkspaceBindFolderRequest,
  type WorkspaceClaudeTrustRequest,
  type WorkspaceImageThumbnailResult,
  type WorkspaceQuickLookImageResult,
  type WorkspaceImageSiblingsResult,
  type WorkspaceReadAgentPageResult,
  type WorkspaceReadFileResult,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import { openExternalUrl } from "./external-url.js";
import { openExternalTerminal } from "./external-terminal.js";
import type { WorkspaceStore } from "./workspace-store.js";
import { IMAGE_OR_PAGE_PATH, resolveLinkedImage, resolveWorkspacePathForReveal } from "./workspace-path.js";
import { scratchWorkspacePath } from "./codex-scratch.js";
import { worktreesOf } from "./git-work-tree.js";
import { claudeTrustsFolder } from "./claude-trust.js";

// shortcut: a page goes to the renderer whole; past a few MB it is data, not a diagram.
const AGENT_PAGE_MAX_BYTES = 5 * 1024 * 1024;
// A PDF or screenshot goes to the renderer whole, to be drawn beside the terminal.
const VIEWED_FILE_MAX_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_SIBLINGS = 200;

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
      // 640px covers a hover card at 2x. Linux has no system thumbnailer, so it decodes the file.
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
    const result = await resolveLinkedImage(request, { accept: IMAGE_OR_PAGE_PATH });
    if (!result.ok) return result;
    // Quick Look shows a page without running its scripts, which draw most charts and diagrams.
    if (PAGE_PATH.test(result.resolvedPath)) {
      const error = await shell.openPath(result.resolvedPath);
      return error ? { ok: false, error } : { ok: true };
    }
    // ponytail: Quick Look is macOS only; other systems need their own viewer (shell.openPath) if Alfred ships there.
    if (process.platform !== "darwin") return { ok: false, error: "Quick Look is not available on this system." };
    BrowserWindow.fromWebContents(event.sender)?.previewFile(result.resolvedPath);
    return { ok: true };
  });
  trustedIpc.handle(workspaceChannels.readAgentPage, async (_event, request): Promise<WorkspaceReadAgentPageResult> => {
    const result = await resolveLinkedImage(request, { accept: PAGE_PATH, maxBytes: AGENT_PAGE_MAX_BYTES });
    if (!result.ok) return result;
    try {
      const [text, stat] = await Promise.all([fs.readFile(result.resolvedPath, "utf8"), fs.stat(result.resolvedPath)]);
      return { ok: true, text, modifiedAt: stat.mtimeMs };
    } catch {
      return { ok: false, error: "Page does not exist." };
    }
  });
  trustedIpc.handle(workspaceChannels.readFile, async (_event, request): Promise<WorkspaceReadFileResult> => {
    const result = await resolveLinkedImage(request, { accept: VIEWABLE_FILE_PATH, maxBytes: VIEWED_FILE_MAX_BYTES });
    if (!result.ok) return result;
    try {
      const [bytes, stat] = await Promise.all([fs.readFile(result.resolvedPath), fs.stat(result.resolvedPath)]);
      return { ok: true, bytes: new Uint8Array(bytes), modifiedAt: stat.mtimeMs };
    } catch {
      return { ok: false, error: "File does not exist." };
    }
  });
  trustedIpc.handle(workspaceChannels.imageSiblings, async (_event, request): Promise<WorkspaceImageSiblingsResult> => {
    const result = await resolveLinkedImage(request);
    if (!result.ok) return result;
    const folder = path.dirname(result.resolvedPath);
    try {
      const names = (await fs.readdir(folder)).filter((name) => ATTACHABLE_IMAGE_PATH.test(name)).sort();
      return { ok: true, images: names.slice(0, MAX_IMAGE_SIBLINGS).map((name) => path.join(folder, name)) };
    } catch {
      return { ok: false, error: "Folder does not exist." };
    }
  });
  trustedIpc.handle(workspaceChannels.revealPath, async (_event, request) => {
    const result = await resolveWorkspacePathForReveal(request, { allowedRoots: await allowedWorkspaceRoots(store, options) });
    if (result.ok) {
      shell.showItemInFolder(result.resolvedPath);
    }
    return result;
  });
  trustedIpc.handle(workspaceChannels.claudeTrust, async (_event, request: WorkspaceClaudeTrustRequest) => {
    const { workspaces } = await store.getWorkspaceState();
    const rootPath = workspaces.find((workspace) => workspace.id === request?.workspaceId)?.rootPath;
    return rootPath ? claudeTrustsFolder(rootPath) : true;
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

export type TerminalSessionId = string;

export type TerminalCreateRequest = {
  cwd?: string;
  cols: number;
  rows: number;
};

export type TerminalCreateResult = {
  id: TerminalSessionId;
  cwd: string;
  shell: string;
};

export type TerminalResizeRequest = {
  id: TerminalSessionId;
  cols: number;
  rows: number;
};

export type TerminalWriteRequest = {
  id: TerminalSessionId;
  data: string;
};

export type TerminalKillRequest = {
  id: TerminalSessionId;
};

export type TerminalExitEvent = {
  id: TerminalSessionId;
  exitCode: number;
  signal?: number;
};

export type TerminalDataEvent = {
  id: TerminalSessionId;
  data: string;
};

export type TerminalApi = {
  create(request: TerminalCreateRequest): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  kill(request: TerminalKillRequest): void;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
};

export const terminalChannels = {
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;

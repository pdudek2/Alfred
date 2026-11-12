export declare const DEV_ROOT_PATH: string;
export declare function electronArguments(userDataDirectory: string | undefined): string[];
export declare function devServerOwner(url: string, appDirectory: string): Promise<"none" | "other" | "this checkout">;

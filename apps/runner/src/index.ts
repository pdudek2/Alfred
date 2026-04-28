import { loadRunnerConfig } from "./config.js";

const config = loadRunnerConfig();

console.log(`Alfred runner configured for ${config.apiUrl}`);

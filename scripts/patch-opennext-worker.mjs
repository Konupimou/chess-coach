import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const consoleFilePath = resolve(
  root,
  ".open-next/server-functions/default/node_modules/next/dist/server/node-environment-extensions/console-file.js",
);
const fileLoggerPath = resolve(
  root,
  ".open-next/server-functions/default/node_modules/next/dist/server/dev/browser-logs/file-logger.js",
);

const consoleFileStub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Cloudflare workers cannot load Next.js' dev file logger path.
// We intentionally no-op the server console patch in this environment.
`;

const fileLoggerStub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "FileLogger", { enumerable: true, get: function () { return FileLogger; } });
Object.defineProperty(exports, "getFileLogger", { enumerable: true, get: function () { return getFileLogger; } });
Object.defineProperty(exports, "test__resetFileLogger", { enumerable: true, get: function () { return test__resetFileLogger; } });
class FileLogger {
  initialize() {}
  getLogQueue() { return []; }
  flush() {}
  enqueueLog() {}
  log() {}
  logServer() {}
  logBrowser() {}
  forceFlush() {}
  destroy() {}
}
function getFileLogger() {
  return new FileLogger();
}
function test__resetFileLogger() {}
`;

for (const [target, content] of [
  [consoleFilePath, consoleFileStub],
  [fileLoggerPath, fileLoggerStub],
]) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

console.log("Patched OpenNext worker logging shims.");

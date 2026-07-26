import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const handlerPath = resolve(
  root,
  ".open-next/server-functions/default/handler.mjs",
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

// OpenNext bundles the Next.js files into handler.mjs before this script runs.
// Patching only the copied files is therefore not enough: remove the bundled
// file logger as well so Cloudflare never evaluates its Node-only require("fs").
const bundledFileLoggerPattern =
  /var require_file_logger=__commonJS\(\{".open-next\/server-functions\/default\/node_modules\/next\/dist\/server\/dev\/browser-logs\/file-logger\.js"\(exports\)\{[\s\S]*?\}\}\);var require_interop_require_default=/;
const bundledFileLoggerStub =
  'var require_file_logger=__commonJS({".open-next/server-functions/default/node_modules/next/dist/server/dev/browser-logs/file-logger.js"(exports){"use strict";Object.defineProperty(exports,"__esModule",{value:!0});class FileLogger{initialize(){}getLogQueue(){return[]}flush(){}enqueueLog(){}log(){}logServer(){}logBrowser(){}forceFlush(){}destroy(){}}function getFileLogger(){return new FileLogger}function test__resetFileLogger(){}Object.assign(exports,{FileLogger,getFileLogger,test__resetFileLogger})}});var require_interop_require_default=';

const bundledConsoleDimPattern =
  /var require_console_dim_external=__commonJS\(\{".open-next\/server-functions\/default\/node_modules\/next\/dist\/server\/node-environment-extensions\/console-dim\.external\.js"\(exports\)\{[\s\S]*?\}\}\);var require_unhandled_rejection_external=/;
const bundledConsoleDimStub =
  'var require_console_dim_external=__commonJS({".open-next/server-functions/default/node_modules/next/dist/server/node-environment-extensions/console-dim.external.js"(exports){"use strict";Object.defineProperty(exports,"__esModule",{value:!0});function setAbortedLogsStyle(){}Object.defineProperty(exports,"setAbortedLogsStyle",{enumerable:!0,get:function(){return setAbortedLogsStyle}})}});var require_unhandled_rejection_external=';

let handler = readFileSync(handlerPath, "utf8");
if (!bundledFileLoggerPattern.test(handler)) {
  throw new Error("Bundled Next.js file logger was not found in handler.mjs");
}
handler = handler.replace(bundledFileLoggerPattern, bundledFileLoggerStub);

if (!bundledConsoleDimPattern.test(handler)) {
  throw new Error("Bundled Next.js console dimmer was not found in handler.mjs");
}
handler = handler.replace(bundledConsoleDimPattern, bundledConsoleDimStub);

writeFileSync(handlerPath, handler);

console.log("Patched OpenNext worker logging shims and Node-only console modules.");

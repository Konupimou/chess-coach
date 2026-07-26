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

// Next 16.2 can leave direct CommonJS require() calls in the ESM server bundle
// (for example in node-environment-extensions/node-crypto.js). Wrangler's local
// runtime supplies require implicitly, while the production Worker does not.
// Define it explicitly through the Node compatibility layer before any bundled
// module is evaluated.
const createRequireImport =
  'import { createRequire as __createNodeRequire } from "node:module";\n';
const createRequireBinding =
  'const require = __createNodeRequire("/worker/handler.mjs");\n';
if (!handler.includes(createRequireImport)) {
  handler = `${createRequireImport}${createRequireBinding}${handler}`;
}

if (!bundledFileLoggerPattern.test(handler)) {
  throw new Error("Bundled Next.js file logger was not found in handler.mjs");
}
handler = handler.replace(bundledFileLoggerPattern, bundledFileLoggerStub);

if (!bundledConsoleDimPattern.test(handler)) {
  throw new Error("Bundled Next.js console dimmer was not found in handler.mjs");
}
handler = handler.replace(bundledConsoleDimPattern, bundledConsoleDimStub);

writeFileSync(handlerPath, handler);

console.log("Patched OpenNext worker CommonJS bridge and Node-only console modules.");

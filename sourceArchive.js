import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";

const DEFAULT_USED_DIRECTORY = "used";
const HASH_LENGTH = 12;

const DEFAULT_OPERATIONS = Object.freeze({
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  unlink,
});

function validateUsedDirectoryName(value) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value === "."
    || value === ".."
    || basename(value) !== value
  ) {
    throw new TypeError("usedDirectoryName must be one directory name");
  }
  return value;
}

function normalizeSourcePaths(sourcePaths) {
  if (!Array.isArray(sourcePaths)) {
    throw new TypeError("sourcePaths must be an explicit array of file paths");
  }
  const normalized = [];
  const seen = new Set();
  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== "string" || !sourcePath.trim()) {
      throw new TypeError("Every source path must be a non-empty string");
    }
    const absolutePath = resolve(sourcePath);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    normalized.push(absolutePath);
  }
  return normalized;
}

async function pathInfo(filePath, operations) {
  try {
    return await operations.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fileDigest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesAreIdentical(leftPath, leftInfo, rightPath, rightInfo) {
  if (!leftInfo?.isFile() || !rightInfo?.isFile() || leftInfo.size !== rightInfo.size) {
    return false;
  }
  if (leftInfo.dev === rightInfo.dev && leftInfo.ino === rightInfo.ino) return true;
  const [leftDigest, rightDigest] = await Promise.all([
    fileDigest(leftPath),
    fileDigest(rightPath),
  ]);
  return leftDigest === rightDigest;
}

function collisionFileName(fileName, digest, collisionIndex) {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length) || fileName;
  const suffix = collisionIndex > 1 ? `-${collisionIndex}` : "";
  return `${stem}.${digest.slice(0, HASH_LENGTH)}${suffix}${extension}`;
}

async function copyAcrossDevices(sourcePath, destinationPath, operations) {
  const temporaryPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;
  try {
    await operations.copyFile(sourcePath, temporaryPath, fsConstants.COPYFILE_EXCL);
    temporaryCreated = true;
    const temporaryHandle = await operations.open(temporaryPath, "r");
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    const [sourceInfo, temporaryInfo] = await Promise.all([
      operations.lstat(sourcePath),
      operations.lstat(temporaryPath),
    ]);
    if (!await filesAreIdentical(sourcePath, sourceInfo, temporaryPath, temporaryInfo)) {
      const error = new Error(`Archive copy verification failed for ${sourcePath}`);
      error.code = "EARCHIVEVERIFY";
      throw error;
    }
    // Hard-linking the verified temporary file publishes the destination
    // atomically and, unlike rename(), can never overwrite a concurrent file.
    await operations.link(temporaryPath, destinationPath);
    await operations.unlink(temporaryPath);
    temporaryCreated = false;
    await operations.unlink(sourcePath);
    return "copy_link_unlink";
  } catch (error) {
    if (temporaryCreated) {
      try {
        await operations.unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            `Archive copy and cleanup failed for ${sourcePath}`,
          );
        }
      }
    }
    throw error;
  }
}

async function moveFile(sourcePath, destinationPath, operations) {
  try {
    // A hard link followed by unlink has move semantics on one filesystem and
    // is no-clobber by construction. POSIX rename() would overwrite silently.
    await operations.link(sourcePath, destinationPath);
    await operations.unlink(sourcePath);
    return "link_unlink";
  } catch (error) {
    if (!["EXDEV", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
    return copyAcrossDevices(sourcePath, destinationPath, operations);
  }
}

async function archiveOneSource(sourcePath, usedDirectoryName, operations) {
  const sourceInfo = await pathInfo(sourcePath, operations);
  if (!sourceInfo) {
    const error = new Error(`Processed source file does not exist: ${sourcePath}`);
    error.code = "ENOENT";
    throw error;
  }
  if (!sourceInfo.isFile()) {
    throw new TypeError(`Processed source must be a regular file: ${sourcePath}`);
  }

  if (basename(dirname(sourcePath)) === usedDirectoryName) {
    return {
      sourcePath,
      destinationPath: sourcePath,
      status: "already_archived",
      method: "none",
    };
  }

  const usedDirectory = join(dirname(sourcePath), usedDirectoryName);
  await operations.mkdir(usedDirectory, { recursive: true });
  const fileName = basename(sourcePath);
  let sourceDigest = "";

  for (let collisionIndex = 0; ; collisionIndex += 1) {
    if (collisionIndex === 1 && !sourceDigest) sourceDigest = await fileDigest(sourcePath);
    const destinationPath = collisionIndex === 0
      ? join(usedDirectory, fileName)
      : join(usedDirectory, collisionFileName(fileName, sourceDigest, collisionIndex));
    const destinationInfo = await pathInfo(destinationPath, operations);

    if (destinationInfo) {
      if (await filesAreIdentical(sourcePath, sourceInfo, destinationPath, destinationInfo)) {
        await operations.unlink(sourcePath);
        return {
          sourcePath,
          destinationPath,
          status: "deduplicated",
          method: "unlink_duplicate",
        };
      }
      continue;
    }

    try {
      const method = await moveFile(sourcePath, destinationPath, operations);
      return {
        sourcePath,
        destinationPath,
        status: "archived",
        method,
      };
    } catch (error) {
      // A concurrent archive may have claimed this exact path after the
      // existence check. Re-evaluate it without ever overwriting its data.
      if (error?.code === "EEXIST") continue;
      throw error;
    }
  }
}

/**
 * Archives only the exact source files supplied by the caller.
 *
 * Each file is moved to a `used/` directory beside it. The helper never
 * discovers files, expands globs, or removes a directory. Callers should pass
 * this function only files whose processing completed successfully.
 */
export async function archiveProcessedSources(sourcePaths, {
  usedDirectoryName = DEFAULT_USED_DIRECTORY,
  operations: operationOverrides = {},
} = {}) {
  const exactSourcePaths = normalizeSourcePaths(sourcePaths);
  const safeUsedDirectoryName = validateUsedDirectoryName(usedDirectoryName);
  const operations = { ...DEFAULT_OPERATIONS, ...operationOverrides };
  const results = [];
  for (const sourcePath of exactSourcePaths) {
    results.push(await archiveOneSource(sourcePath, safeUsedDirectoryName, operations));
  }
  return results;
}

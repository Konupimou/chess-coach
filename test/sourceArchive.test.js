import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link as fsLink, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveProcessedSources } from "../sourceArchive.js";

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function fixtureDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "chess-coach-source-archive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("archives only explicitly listed source files in a sibling used directory", async (t) => {
  const directory = await fixtureDirectory(t);
  const processed = join(directory, "processed.pgn");
  const untouched = join(directory, "not-processed.pgn");
  await Promise.all([
    writeFile(processed, "processed data", "utf8"),
    writeFile(untouched, "leave this here", "utf8"),
  ]);

  const [result] = await archiveProcessedSources([processed]);

  assert.equal(result.status, "archived");
  assert.equal(result.method, "link_unlink");
  assert.equal(result.destinationPath, join(directory, "used", "processed.pgn"));
  assert.equal(await pathExists(processed), false);
  assert.equal(await readFile(result.destinationPath, "utf8"), "processed data");
  assert.equal(await readFile(untouched, "utf8"), "leave this here");
});

test("removes the source when an identical destination already exists", async (t) => {
  const directory = await fixtureDirectory(t);
  const usedDirectory = join(directory, "used");
  const source = join(directory, "lesson.pgn");
  const destination = join(usedDirectory, "lesson.pgn");
  await mkdir(usedDirectory);
  await Promise.all([
    writeFile(source, "same bytes", "utf8"),
    writeFile(destination, "same bytes", "utf8"),
  ]);

  const [result] = await archiveProcessedSources([source]);

  assert.equal(result.status, "deduplicated");
  assert.equal(result.destinationPath, destination);
  assert.equal(await pathExists(source), false);
  assert.equal(await readFile(destination, "utf8"), "same bytes");
});

test("keeps a different same-name destination and chooses a deterministic hash name", async (t) => {
  const directory = await fixtureDirectory(t);
  const usedDirectory = join(directory, "used");
  const source = join(directory, "lesson.pgn");
  const originalDestination = join(usedDirectory, "lesson.pgn");
  const sourceContent = "new lesson data";
  const digest = createHash("sha256").update(sourceContent).digest("hex").slice(0, 12);
  const uniqueDestination = join(usedDirectory, `lesson.${digest}.pgn`);
  await mkdir(usedDirectory);
  await Promise.all([
    writeFile(source, sourceContent, "utf8"),
    writeFile(originalDestination, "older, different data", "utf8"),
  ]);

  const [result] = await archiveProcessedSources([source]);

  assert.equal(result.status, "archived");
  assert.equal(result.destinationPath, uniqueDestination);
  assert.equal(await readFile(originalDestination, "utf8"), "older, different data");
  assert.equal(await readFile(uniqueDestination, "utf8"), sourceContent);
});

test("deduplicates against the deterministic collision destination on a repeat import", async (t) => {
  const directory = await fixtureDirectory(t);
  const usedDirectory = join(directory, "used");
  const source = join(directory, "lesson.pgn");
  const sourceContent = "repeated new lesson";
  const digest = createHash("sha256").update(sourceContent).digest("hex").slice(0, 12);
  const hashedDestination = join(usedDirectory, `lesson.${digest}.pgn`);
  await mkdir(usedDirectory);
  await Promise.all([
    writeFile(source, sourceContent, "utf8"),
    writeFile(join(usedDirectory, "lesson.pgn"), "different", "utf8"),
    writeFile(hashedDestination, sourceContent, "utf8"),
  ]);

  const [result] = await archiveProcessedSources([source]);

  assert.equal(result.status, "deduplicated");
  assert.equal(result.destinationPath, hashedDestination);
  assert.equal(await pathExists(source), false);
});

test("falls back to a verified atomic copy when the archive is on another device", async (t) => {
  const directory = await fixtureDirectory(t);
  const source = join(directory, "cross-device.pgn");
  await writeFile(source, "portable archive", "utf8");
  let sourceLinkCalls = 0;

  const [result] = await archiveProcessedSources([source], {
    operations: {
      async link(existingPath, newPath) {
        if (existingPath === source) {
          sourceLinkCalls += 1;
          const error = new Error("cross-device link not permitted");
          error.code = "EXDEV";
          throw error;
        }
        return fsLink(existingPath, newPath);
      },
    },
  });

  assert.equal(sourceLinkCalls, 1);
  assert.equal(result.status, "archived");
  assert.equal(result.method, "copy_link_unlink");
  assert.equal(await pathExists(source), false);
  assert.equal(await readFile(result.destinationPath, "utf8"), "portable archive");
});

test("does not create nested used directories and ignores duplicate path arguments", async (t) => {
  const directory = await fixtureDirectory(t);
  const usedDirectory = join(directory, "used");
  const source = join(usedDirectory, "already-there.pgn");
  await mkdir(usedDirectory);
  await writeFile(source, "archived", "utf8");

  const results = await archiveProcessedSources([source, source]);

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "already_archived");
  assert.equal(results[0].destinationPath, source);
  assert.equal(await pathExists(join(usedDirectory, "used")), false);
  assert.equal(await readFile(source, "utf8"), "archived");
});

test("rejects directories instead of discovering or broadly moving their contents", async (t) => {
  const directory = await fixtureDirectory(t);
  const nestedFile = join(directory, "nested.pgn");
  await writeFile(nestedFile, "keep", "utf8");

  await assert.rejects(
    archiveProcessedSources([directory]),
    /must be a regular file/,
  );
  assert.equal(await readFile(nestedFile, "utf8"), "keep");
  assert.equal(await pathExists(join(directory, "used")), false);
});

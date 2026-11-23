// Remove build outputs and caches across the workspace.
//
//   bun run clean              build outputs, Turbo and Next caches, generated Prisma client
//   bun run clean --deps       also every node_modules (run `bun install` afterwards)
//   bun run clean --dry-run    list what would be removed
//
// Only paths git reports as ignored are removed, so tracked or untracked source never goes.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $, Glob } from "bun";

const root = join(import.meta.dir, "../../..");
const args = new Set(Bun.argv.slice(2));
const dryRun = args.has("--dry-run");
const withDeps = args.has("--deps");

const ARTIFACTS = [
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  "generated",
  "next-env.d.ts",
  "*.tsbuildinfo",
  "node_modules/.cache",
];
const patterns = withDeps ? [...ARTIFACTS, "node_modules"] : ARTIFACTS;

const scan = (pattern: string, cwd: string) =>
  Array.fromAsync(new Glob(pattern).scan({ cwd, dot: true, onlyFiles: false }));

const pkg = await Bun.file(join(root, "package.json")).json();
const workspaceDirs = (
  await Promise.all(
    (pkg.workspaces ?? []).map((pattern: string) => scan(pattern, root))
  )
).flat();
const packageDirs = [
  ".",
  ...(
    await Promise.all(
      workspaceDirs.map(async (dir) =>
        (await Bun.file(join(root, dir, "package.json")).exists()) ? dir : null
      )
    )
  ).filter((dir) => dir !== null),
];

const matches = await Promise.all(
  packageDirs.flatMap((dir) =>
    patterns.map(async (pattern) =>
      (await scan(pattern, join(root, dir))).map((match) =>
        dir === "." ? match : `${dir}/${match}`
      )
    )
  )
);

// Drop paths nested under another candidate (node_modules/.cache under node_modules).
const candidates = [...new Set(matches.flat())].sort();
const nested = (path: string) =>
  candidates.some((other) => other !== path && path.startsWith(`${other}/`));
const unique = candidates.filter((path) => !nested(path));

// One `git check-ignore` call reports which candidates are ignored; keep only those.
const ignored = new Set(
  unique.length === 0
    ? []
    : (
        await $`git check-ignore --stdin < ${new Response(unique.join("\n"))}`
          .cwd(root)
          .nothrow()
          .text()
      )
        .split("\n")
        .filter(Boolean)
);
for (const path of unique) {
  if (!ignored.has(path)) {
    console.warn(`skip (not git-ignored): ${path}`);
  }
}
const targets = unique.filter((path) => ignored.has(path));

for (const target of targets) {
  console.log(`${dryRun ? "would remove" : "remove"} ${target}`);
}
if (!dryRun) {
  await Promise.all(
    targets.map((target) =>
      rm(join(root, target), { force: true, recursive: true })
    )
  );
}

console.log(
  targets.length === 0
    ? "Nothing to clean."
    : `${dryRun ? "Would remove" : "Removed"} ${targets.length} path(s).`
);

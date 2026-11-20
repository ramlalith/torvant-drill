import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const forbiddenPatterns = [
  /from\s+["']child_process["']/,
  /require\s*\(\s*["']child_process["']\s*\)/,
  /\bexec\s*\(/,
  /\bexecSync\s*\(/,
  /\bspawn\s*\(/,
  /\bspawnSync\s*\(/,
  /\bfork\s*\(/,
  /\bexecFile\s*\(/,
  /\bexecFileSync\s*\(/
];

function getSourceFiles(dir: string): string[] {
  let files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git"
      ) {
        continue;
      }
      files = files.concat(getSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") ||
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".mjs") ||
        entry.name.endsWith(".cjs"))
    ) {
      // Exclude this test file itself so it doesn't trigger on its own regex pattern definitions
      if (!entry.name.endsWith("safety.test.ts")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

describe("Safety Check: No Command Execution", () => {
  it("ensures no source file imports child_process or executes commands", () => {
    const projectRoot = process.cwd();
    const srcDir = path.join(projectRoot, "src");
    const sourceFiles = getSourceFiles(srcDir);

    assert(sourceFiles.length > 0, "Source files must exist to verify");

    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(projectRoot, file),
              line: index + 1,
              match: line.trim()
            });
          }
        }
      });
    }

    assert.strictEqual(
      violations.length,
      0,
      `Safety violation! Found command execution imports/calls:\n${violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.match}`)
        .join("\n")}`
    );
  });
});

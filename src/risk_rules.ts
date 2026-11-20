import fs from "fs";
import path from "path";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskAnalysis {
  flags: string[];
  level: RiskLevel;
}

// Load allowed store packages from data/store_packages.json
function loadStorePackages(): string[] {
  try {
    const filePath = path.resolve(process.cwd(), "data/store_packages.json");
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (_) {}
  return ["react", "express", "pg", "jest", "prettier"];
}

/**
 * Returns true if the command contains "prod" as its own word or name part.
 * Matches: prod, PROD_DB, kaveri-prod, prod-db, $PROD
 * Does NOT match: products, production (unless followed by a separator)
 *
 * Rule: "prod" must be:
 * - preceded by a word boundary or start of string, $, or a separator (-, _)
 * - followed by a word boundary, end of string, or a separator (-, _, letters/digits
 *   that are not purely alphabetic continuation that forms a longer word)
 *
 * Specifically we DON'T match "prod" when immediately followed by a letter that
 * makes it part of a longer natural English word (products, production, etc.)
 * We DO match when "prod" is followed by end, separator, digit, or uppercase letter.
 */
function containsProdToken(command: string): boolean {
  // Split on whitespace and common separators to get individual tokens
  const tokens = command.split(/[\s"'`=,;()[\]{}]+/);
  for (const token of tokens) {
    // Strip leading $ (env var prefix)
    const stripped = token.replace(/^\$/, "");
    // Split each token on separators (- _) to get parts
    const parts = stripped.split(/[-_]/);
    for (const part of parts) {
      // "prod" matches if the part is exactly "prod" (case-insensitive)
      // or starts with "prod" followed only by digits (e.g. prod1, prod123)
      // but NOT if followed by letters (which would make "products", "production", etc.)
      if (/^prod\d*$/i.test(part)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pure code risk evaluator. No AI model.
 * Evaluates a task and command against safety rules and returns flags and level.
 */
export function risk_flags(task: string, command: string): RiskAnalysis {
  const flags: string[] = [];

  // 1. Production target:
  // "prod" only as its own word or name part (prod, PROD_DB, kaveri-prod, prod-db)
  // Does NOT match inside "products", "production", etc.
  const isProductionTarget = containsProdToken(command);
  if (isProductionTarget) {
    flags.push("production target");
  }

  // 2. Destructive:
  // DROP, TRUNCATE, DELETE with no WHERE, deleting buckets or backups,
  // rm -r outside the project's own build folders (dist, build)
  let isDestructive = false;

  if (/\b(drop|truncate)\b/i.test(command)) {
    isDestructive = true;
  } else if (/\bdelete\s+from\b/i.test(command) && !/\bwhere\b/i.test(command)) {
    isDestructive = true;
  } else if (
    /\b(delete|drop|remove|rm)\b.*\b(buckets?|backups?)\b/i.test(command) ||
    /\b(buckets?|backups?)\b.*\b(delete|drop|remove|rm)\b/i.test(command)
  ) {
    isDestructive = true;
  } else if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b/i.test(command)) {
    // Check if targeting only build folders (dist, build, ./dist, ./build)
    const args = command
      .replace(/rm\s+(-[a-zA-Z0-9\-_]+\s+)*/g, "")
      .trim()
      .split(/\s+/);
    const nonBuildTargets = args.filter((arg) => {
      const clean = arg.replace(/^(\.\/|\/)/, "").replace(/\/+$/, "");
      return clean !== "dist" && clean !== "build";
    });
    if (nonBuildTargets.length > 0) {
      isDestructive = true;
    }
  }

  if (isDestructive) {
    flags.push("destructive");
  }

  // 3. Exposure:
  // Firewall or access rule open to 0.0.0.0/0, allUsers or public
  const isExposure =
    /0\.0\.0\.0\/0/i.test(command) ||
    /\ballusers\b/i.test(command) ||
    /\bpublic\b/i.test(command);
  if (isExposure) {
    flags.push("exposure");
  }

  // 4. Secrets leaving:
  // A local file such as .env, a key file or credentials is sent to a host outside the project
  const containsSecretFile =
    /(\.env|id_rsa|service[-_]?account.*\.json|credentials|\bkey\.json\b|\.pem\b)/i.test(
      command
    );
  const sendsOutbound =
    /\b(curl|wget|nc|scp|rsync)\b/i.test(command) ||
    /https?:\/\//i.test(command);
  if (containsSecretFile && sendsOutbound) {
    flags.push("secrets leaving");
  }

  // 5. Access rights:
  // owner or editor roles granted, chmod 777
  const isOwnerRights =
    /roles\/(resourcemanager\.)?owner\b/i.test(command) ||
    /--role[=\s]+"?roles\/owner"?/i.test(command);
  const isEditorRights =
    /roles\/(resourcemanager\.)?editor\b/i.test(command) ||
    /--role[=\s]+"?roles\/editor"?/i.test(command);
  const isChmod777 = /\bchmod\s+777\b/i.test(command);

  if (isOwnerRights || isEditorRights || isChmod777) {
    flags.push("access rights");
  }

  // 6. Unsafe shortcut:
  // Force push to main or master, skipping checks or tests (--no-verify)
  const isForcePushMain =
    /\bgit\s+push\b.*(-f\b|--force\b).*\b(main|master)\b/i.test(command) ||
    /\bgit\s+push\b.*\b(main|master)\b.*(-f\b|--force\b)/i.test(command);
  const isSkippingChecks = /--no-verify\b/i.test(command);

  if (isForcePushMain || isSkippingChecks) {
    flags.push("unsafe shortcut");
  }

  // 7. Unknown software:
  // Installing a package not in data/store_packages.json
  const storePackages = new Set(
    loadStorePackages().map((p) => p.trim().toLowerCase())
  );
  const installMatch = command.match(
    /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+(?:add|install))\s+([^;&|]+)/i
  );

  if (installMatch && installMatch[1]) {
    const rawTokens = installMatch[1]
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith("-"));

    for (const pkg of rawTokens) {
      const basePkg = pkg.split("@")[0].toLowerCase();
      if (basePkg && !storePackages.has(basePkg)) {
        flags.push("unknown software");
        break;
      }
    }
  }

  // Determine Level:
  // High: exposure, secrets leaving, owner rights, a force push to main,
  //       or anything destructive on a production target.
  // Medium: unknown software or destructive (on staging or otherwise without production).
  // Low: otherwise.
  let level: "low" | "medium" | "high" = "low";

  const isDestructiveOnProduction =
    flags.includes("destructive") && flags.includes("production target");

  if (
    flags.includes("exposure") ||
    flags.includes("secrets leaving") ||
    isOwnerRights ||
    isForcePushMain ||
    isDestructiveOnProduction
  ) {
    level = "high";
  } else if (flags.includes("unknown software") || flags.includes("destructive")) {
    level = "medium";
  } else if (flags.length > 0) {
    level = "medium";
  }

  return { flags, level };
}

// CamelCase alias
export const riskFlags = risk_flags;

import fs from "fs";
import path from "path";

const packageJsonPath = path.resolve("package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const currentVersion = String(packageJson.appVersion || packageJson.version || "1.0");

const match = currentVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
if (!match) {
  throw new Error(`Invalid appVersion: ${currentVersion}`);
}

const major = Number(match[1]);
const minor = Number(match[2]);
const nextTenths = major * 10 + minor + 1;
const nextVersion = `${Math.floor(nextTenths / 10)}.${nextTenths % 10}.0`;

packageJson.version = nextVersion;
packageJson.appVersion = nextVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
process.stdout.write(nextVersion);

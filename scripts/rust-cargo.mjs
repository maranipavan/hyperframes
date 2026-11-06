import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/rust-cargo.mjs <cargo-command> [args…]");
  process.exit(2);
}

const rustDir = resolve(dirname(fileURLToPath(import.meta.url)), "../rust");
const cargo = process.env.CARGO ?? "cargo";
const cargoPath = resolveExecutable(cargo);
const cargoRealPath = realpathOr(cargoPath);
const cargoBinDir = cargoRealPath ? dirname(cargoRealPath) : undefined;
const env = cargoBinDir
  ? { ...process.env, PATH: `${cargoBinDir}${delimiter}${process.env.PATH ?? ""}` }
  : process.env;
const result = spawnSync(cargoPath, [command, ...args], {
  cwd: rustDir,
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(`[rust] failed to start ${cargoPath}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function resolveExecutable(name) {
  if (name.includes("/") || name.includes("\\")) return name;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function realpathOr(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

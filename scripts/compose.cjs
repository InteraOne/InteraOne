const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const plugin = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
const command = plugin.status === 0 ? "docker" : "docker-compose";
const result = spawnSync(command, plugin.status === 0 ? ["compose", ...args] : args, {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}
process.exitCode = result.status ?? 1;

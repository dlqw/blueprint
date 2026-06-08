const { spawnSync } = require("node:child_process");

const env = { ...process.env };
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "CARGO_HTTP_PROXY"]) {
  env[name] = "";
}

const result = spawnSync("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);

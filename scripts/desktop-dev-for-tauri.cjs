const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const port = 1420;
const root = path.resolve(__dirname, "..");

function isListening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  ensureCompilerBridge();

  if (await isListening()) {
    console.log(`desktop dev server already listening on http://127.0.0.1:${port}`);
    return;
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "desktop:dev"], { stdio: "inherit" });

  const forward = (signal) => {
    child.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function ensureCompilerBridge() {
  const compilerPath = path.join(root, "dist", "shared", "compilerCore.js");
  if (fs.existsSync(compilerPath)) {
    return;
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["run", "compile:shared"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

void main();

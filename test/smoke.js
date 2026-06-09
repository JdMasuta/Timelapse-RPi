// test/smoke.js
// Dependency-free boot smoke test for CI: starts the server with MOCK_CAMERA, then
// verifies the page serves and the Socket.IO endpoint completes a handshake.
// Uses only Node built-ins (http) so it runs on all supported Node versions.

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.SMOKE_PORT || 3010;
const root = path.join(__dirname, "..");

for (const d of ["captures", "videos", "logs", "temp"]) {
  fs.mkdirSync(path.join(root, d), { recursive: true });
}

const server = spawn("node", ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), MOCK_CAMERA: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));

function get(pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "localhost", port: PORT, path: pathname }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      })
      .on("error", reject);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ok = false;
  try {
    for (let i = 0; i < 40 && !out.includes("Server listening"); i++) {
      await wait(250);
    }
    const rootRes = await get("/");
    const handshake = await get("/socket.io/?EIO=4&transport=polling");

    const checks = [
      ["GET / returns 200 HTML", rootRes.status === 200 && /<html/i.test(rootRes.body)],
      ["Socket.IO handshake succeeds", handshake.status === 200 && handshake.body.includes("sid")],
    ];
    ok = checks.every((c) => c[1]);
    for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
  } catch (e) {
    console.error("smoke error:", e.message);
    ok = false;
  } finally {
    server.kill("SIGTERM");
    await wait(500);
    server.kill("SIGKILL");
  }

  if (!ok) {
    console.error("\n--- server output (tail) ---\n" + out.slice(-1200));
    process.exit(1);
  }
  console.log("\nSmoke test passed");
  process.exit(0);
})();

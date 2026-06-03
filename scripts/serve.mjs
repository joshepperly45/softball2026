import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const MAX_PORT_ATTEMPTS = 10;
const rootDir = resolve(process.cwd());

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function getContentType(filePath) {
  return MIME_TYPES[extname(filePath)] || "application/octet-stream";
}

function resolvePath(urlPath) {
  const cleanPath = urlPath.split("?")[0];
  const requestedPath = cleanPath === "/" ? "/index.html" : cleanPath;
  const safePath = normalize(requestedPath).replace(/^([.][.][/\\])+/, "");
  return join(rootDir, safePath);
}

function startServer(port, attemptsRemaining) {
  const server = createServer(async (request, response) => {
    try {
      const filePath = resolvePath(request.url || "/");
      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!existsSync(filePath)) {
        response.writeHead(404).end("Not found");
        return;
      }

      const fileStats = await stat(filePath);
      if (fileStats.isDirectory()) {
        response.writeHead(403).end("Directory listing is not allowed");
        return;
      }

      response.writeHead(200, { "Content-Type": getContentType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(500).end("Server error");
    }
  });

  server.listen(port, () => {
    console.log(`SwanVegas Softball running at http://localhost:${port}`);
  });

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsRemaining > 0) {
      const nextPort = port + 1;
      console.log(`Port ${port} is in use, trying ${nextPort}...`);
      startServer(nextPort, attemptsRemaining - 1);
      return;
    }

    console.error(error.message || error);
    process.exitCode = 1;
  });
}

startServer(PORT, MAX_PORT_ATTEMPTS);
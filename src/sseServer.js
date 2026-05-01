"use strict";
const http = require("http");
const { URL } = require("url");

/**
 * Create a minimal HTTP server exposing:
 * - POST /partner/availability  { restaurantId, itemId, inStock, meta? }
 * - GET  /consumer/state?restaurantId=RID  -> JSON snapshot
 * - GET  /consumer/stream?restaurantId=RID[&since=ts] -> SSE stream of changes
 *
 * This server uses only Node.js built-ins to avoid external deps.
 */
function createSseServer(service, opts = {}) {
  const allowedOrigin = opts.allowedOrigin || "*";
  const heartbeatMs = opts.heartbeatMs || 15000; // keep-alive to traverse proxies

  function writeCors(res) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // CORS preflight
      if (req.method === "OPTIONS") {
        writeCors(res);
        res.statusCode = 204;
        return res.end();
      }

      // Routing
      if (req.method === "POST" && url.pathname === "/partner/availability") {
        writeCors(res);
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}");
            const { restaurantId, itemId, inStock, meta } = parsed;
            if (!restaurantId || !itemId || typeof inStock !== "boolean") {
              res.statusCode = 400;
              return res.end(
                JSON.stringify({ error: "restaurantId, itemId and boolean inStock are required" })
              );
            }

            service.setAvailability(restaurantId, itemId, inStock, meta || {});
            res.statusCode = 204; // No Content
            return res.end();
          } catch (e) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: "Invalid JSON body" }));
          }
        });
        return; // keep handler alive until 'end'
      }

      if (req.method === "GET" && url.pathname === "/consumer/state") {
        writeCors(res);
        const restaurantId = url.searchParams.get("restaurantId");
        if (!restaurantId) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "restaurantId is required" }));
        }
        const snapshot = service.getSnapshot(restaurantId);
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(snapshot));
      }

      if (req.method === "GET" && url.pathname === "/consumer/stream") {
        writeCors(res);
        const restaurantId = url.searchParams.get("restaurantId");
        const since = url.searchParams.get("since");
        if (!restaurantId) {
          res.statusCode = 400;
          return res.end("restaurantId is required\n");
        }

        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        // Initial retry suggestion: if connection drops, retry immediately
        res.write("retry: 1000\n\n");

        // Optional replay for missed changes
        if (since) {
          const sinceTs = Number(since);
          if (!Number.isNaN(sinceTs)) {
            const changes = service.getChangesSince(restaurantId, sinceTs);
            for (const evt of changes) {
              res.write(`event: ${evt.type}\n`);
              res.write(`data: ${JSON.stringify(evt)}\n\n`);
            }
          }
        }

        // Live subscription
        const onChange = (evt) => {
          if (evt.restaurantId !== restaurantId) return;
          res.write(`event: ${evt.type}\n`);
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        };
        service.on("availability.changed", onChange);

        const hb = setInterval(() => {
          res.write(`: hb ${Date.now()}\n\n`);
        }, heartbeatMs);

        // Clean up on close
        req.on("close", () => {
          clearInterval(hb);
          service.off("availability.changed", onChange);
        });
        return; // leave connection open
      }

      // Fallback 404
      writeCors(res);
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  return server;
}

module.exports = { createSseServer };

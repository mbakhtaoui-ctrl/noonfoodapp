"use strict";
const assert = require("assert");
const http = require("http");
const { MenuAvailabilityService } = require("../src/menuAvailabilityService");
const { createSseServer } = require("../src/sseServer");

function httpPostJson({ port, path, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: "POST", host: "127.0.0.1", port, path, headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

describe("SSE server integration", () => {
  it("propagates toggle to consumers within 30 seconds via SSE", async () => {
    const service = new MenuAvailabilityService();
    const server = createSseServer(service);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const gotEvent = new Promise((resolve, reject) => {
      const req = http.request({ method: "GET", host: "127.0.0.1", port, path: "/consumer/stream?restaurantId=r1" });
      req.on("response", (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          // Find first data: line with JSON
          const lines = buf.split(/\n/);
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.itemId === "pizza") {
                  resolve({ evt, receivedAt: Date.now() });
                }
              } catch (e) {
                // ignore parse errors for heartbeat/comments
              }
            }
          }
        });
      });
      req.on("error", reject);
      req.end();
    });

    // Trigger a toggle after client subscribed
    const t0 = Date.now();
    await httpPostJson({ port, path: "/partner/availability", body: { restaurantId: "r1", itemId: "pizza", inStock: false } });

    const { receivedAt } = await Promise.race([
      gotEvent,
      new Promise((_, reject) => setTimeout(() => reject(new Error("No SSE within 30s")), 30_000)),
    ]);

    const delta = receivedAt - t0;
    assert.ok(delta >= 0 && delta <= 30_000, `Propagation exceeded 30s: ${delta}ms`);

    server.close();
  });
});

"use strict";
const { MenuAvailabilityService } = require("./src/menuAvailabilityService");
const { createSseServer } = require("./src/sseServer");

// Boot a minimal real-time availability server
const PORT = Number(process.env.PORT || 8080);

const service = new MenuAvailabilityService();
const server = createSseServer(service);

server.listen(PORT, () => {
  console.log(`[availability] server listening on http://localhost:${PORT}`);
  console.log("Endpoints:\n - POST /partner/availability\n - GET /consumer/state?restaurantId=RID\n - GET /consumer/stream?restaurantId=RID[&since=ts]");
});

module.exports = { service, server };

"use strict";
const assert = require("assert");
const { MenuAvailabilityService } = require("../src/menuAvailabilityService");

function makeClock() {
  let now = 1_700_000_000_000; // fixed start
  return {
    now: () => now,
    tick: (ms) => (now += ms),
  };
}

describe("MenuAvailabilityService", () => {
  it("sets and gets availability, increments version on change", () => {
    const clock = makeClock();
    const svc = new MenuAvailabilityService({ clock: clock.now });

    let res = svc.setAvailability("r1", "i1", false);
    assert.equal(res.changed, true);
    assert.equal(svc.getAvailability("r1", "i1").inStock, false);
    assert.equal(svc.getAvailability("r1", "i1").version, 1);

    // idempotent update should not bump version
    res = svc.setAvailability("r1", "i1", false);
    assert.equal(res.changed, false);
    assert.equal(svc.getAvailability("r1", "i1").version, 1);

    // change back to true increases version
    res = svc.setAvailability("r1", "i1", true);
    assert.equal(res.changed, true);
    assert.equal(svc.getAvailability("r1", "i1").version, 2);
  });

  it("emits event on change and supports replay via getChangesSince", (done) => {
    const clock = makeClock();
    const svc = new MenuAvailabilityService({ clock: clock.now });

    let seen = [];
    svc.on("availability.changed", (evt) => {
      seen.push(evt);
    });

    const t0 = clock.now();
    svc.setAvailability("r1", "burger", false, { partnerId: "p1" });
    clock.tick(1000);
    const t1 = clock.now();
    svc.setAvailability("r1", "fries", true);

    // Allow event loop to process
    setTimeout(() => {
      try {
        if (seen.length < 2) throw new Error("Expected 2 events");
        const replay = svc.getChangesSince("r1", t0);
        assert.ok(replay.some((e) => e.itemId === "fries"));
        assert.ok(replay.every((e) => e.ts > t0));
        const replay2 = svc.getChangesSince("r1", t1);
        assert.ok(replay2.every((e) => e.itemId !== "burger"));
        done();
      } catch (e) {
        done(e);
      }
    }, 0);
  });
});

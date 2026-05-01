"use strict";
const fs = require("fs");
const path = require("path");

let tests = [];
let currentSuite = null;

function describe(name, fn) {
  const prev = currentSuite;
  const suite = { name, tests: [] };
  currentSuite = suite;
  fn();
  currentSuite = prev;
  tests.push(suite);
}

function it(name, fn) {
  if (!currentSuite) currentSuite = { name: "", tests: [] };
  currentSuite.tests.push({ name, fn });
}

global.describe = describe;
global.it = it;

async function run() {
  const dir = path.join(__dirname, "tests");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js"));
  let failed = 0;
  for (const file of files) {
    require(path.join(dir, file));
  }
  for (const suite of tests) {
    console.log(`# ${suite.name}`);
    for (const t of suite.tests) {
      const start = Date.now();
      try {
        const maybe = t.fn.length > 0 ? new Promise((res, rej) => t.fn((e) => (e ? rej(e) : res()))) : t.fn();
        if (maybe && typeof maybe.then === "function") await maybe;
        const dur = Date.now() - start;
        console.log(`✓ ${t.name} (${dur}ms)`);
      } catch (e) {
        failed++;
        console.error(`✗ ${t.name}`);
        console.error(e && e.stack ? e.stack : e);
      }
    }
  }
  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log("\nAll tests passed");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

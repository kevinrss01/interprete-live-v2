import assert from "node:assert/strict";
import test from "node:test";
import { cargoRunnerArgs, developmentIdentity } from "./dev-macos-config.mjs";

test("Cargo runner paths remain separate arguments, including spaces and quotes", () => {
  const args = cargoRunnerArgs("/some path/node", '/project "local"/runner.mjs');
  for (const index of [1, 3]) {
    assert.deepEqual(JSON.parse(args[index].slice(args[index].indexOf("=") + 1)),
      ["/some path/node", '/project "local"/runner.mjs']);
  }
});

test("persistent signing prefers development, supports an explicit valid certificate and refuses ad hoc fallback", () => {
  const development = "A".repeat(40), distribution = "B".repeat(40);
  const identities = `1) ${distribution} "Developer ID Application: example"\n2) ${development} "Apple Development: example"`;
  assert.equal(developmentIdentity(identities), development);
  assert.equal(developmentIdentity(identities, distribution), distribution);
  assert.throws(() => developmentIdentity(identities, "C".repeat(40)), /valid local/);
  assert.throws(() => developmentIdentity("0 valid identities found"), /valid local/);
});

export function cargoRunnerArgs(node, runner) {
  const command = JSON.stringify([node, runner]);
  return ["--config", `target.aarch64-apple-darwin.runner=${command}`,
    "--config", `target.x86_64-apple-darwin.runner=${command}`];
}

export function developmentIdentity(identities, configured) {
  const available = [...identities.matchAll(/([A-F0-9]{40}) "(Apple Development:|Developer ID Application:)/g)];
  const identity = configured
    ? available.find(match => match[1] === configured)?.[1]
    : (available.find(match => match[2] === "Apple Development:") || available[0])?.[1];
  if (!identity) throw new Error("A valid local Apple Development or Developer ID signing identity is required for persistent Mac permissions.");
  return identity;
}

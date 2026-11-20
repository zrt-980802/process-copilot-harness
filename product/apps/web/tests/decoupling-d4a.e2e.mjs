// D4A retry compatibility shares the current production UI fixture and neutral shell.
// This remains synthetic browser verification, not EE/Runtime business acceptance.
process.argv.push("--d4a");
await import("./frontend-provider-isolation.e2e.mjs");

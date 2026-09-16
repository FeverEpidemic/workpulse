import { serializeWorkerBootstrap } from "./bootstrap.ts";

/**
 * `pnpm worker:check` entrypoint: print the bootstrap payload as a single JSON line
 * and exit with code 0. Anything written to stdout is a machine-readable contract,
 * so diagnostics belong on stderr.
 */
process.stdout.write(`${serializeWorkerBootstrap()}\n`);

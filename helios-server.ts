#!/usr/bin/env bun
/**
 * Helios standalone server entrypoint.
 *
 * Usage:
 *   bun run helios-server.ts                          # start with defaults
 *   bun run helios-server.ts --config helios.yml      # start with config file
 *   bun run helios-server.ts --port 5701              # explicit port
 *   bun run helios-server.ts --help                   # show help
 */
import { parseCli, helpText } from './src/server/cli';
import { HeliosServer } from './src/server/HeliosServer';
import { HeliosConfig } from './src/config/HeliosConfig';

const args = parseCli(process.argv.slice(2));

if (args.help) {
    console.log(helpText());
    process.exit(0);
}

const server = new HeliosServer();
server.installSignalHandlers();

// Resolve config
let configOrFile: HeliosConfig | string | undefined;
if (args.configFile) {
    configOrFile = args.configFile;
} else if (args.port !== undefined) {
    const config = new HeliosConfig();
    config.getNetworkConfig().setPort(args.port);
    configOrFile = config;
}

await server.start(configOrFile);

const instance = server.getInstance()!;
const port = server.getBoundPort();
console.log(`Helios instance "${instance.getName()}" started${port !== null ? ` on port ${port}` : ''}`);
console.log('Press Ctrl+C to shut down.');

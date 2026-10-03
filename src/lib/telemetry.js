import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Anonymous usage stats: which commands run, which flags they get, on what
// platform. Free-text flags (repo names, URLs, paths, messages, schemes) are
// reported only as "set", never by value. Opt out with DO_NOT_TRACK=1 or
// NATIVE_SIM_TELEMETRY_DISABLED=1. Requests are capped and errors swallowed:
// telemetry must never slow down or break a command.
//
// Shares a PostHog project with rnd (@react-native-feel/deploy); every event
// carries cli: "native-sim" to tell them apart. The project token can only
// write events, so it is safe to ship.

const KEY = 'phc_BhqIVjqo3bFgH9DXqZxs3fUemr4FsF3YqRn655AULe9';
const HOST = process.env.NATIVE_SIM_TELEMETRY_HOST || 'https://us.i.posthog.com';
const TIMEOUT_MS = 1500;

const COMMANDS = new Set(['up', 'init', 'status', 'down', 'doctor', 'upload', 'r2', 'turn', 'help', 'version']);

// Flags whose values are a fixed set or a number, so the value itself is the
// signal. Everything else is reported as `true`.
const VALUE_FLAGS = new Set(['mode', 'transport', 'codec', 'minutes', 'max-dimension', 'fps', 'quality', 'device']);

const truthy = (value) => value !== undefined && value !== '' && value !== '0' && value !== 'false';

// A git checkout is a development copy (npm link, or running bin/ directly);
// the npm tarball has no .git. Keeps our own runs out of the numbers.
const fromCheckout = existsSync(new URL('../../.git', import.meta.url));

export function telemetryEnabled(env = process.env) {
  return !fromCheckout && !truthy(env.DO_NOT_TRACK) && !truthy(env.NATIVE_SIM_TELEMETRY_DISABLED);
}

function configDir() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'native-sim');
}

// A random ID per machine, created on first run, so users can be counted
// without being identified.
function anonymousId() {
  const file = join(configDir(), 'telemetry.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')).id;
  } catch {
    const id = randomUUID();
    try {
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(file, JSON.stringify({ id }));
    } catch {
      // A read-only home still gets counted, just as a new user each run.
    }
    console.error(
      'native-sim collects anonymous usage stats (commands and flags, never values or paths).\n' +
        'Opt out with DO_NOT_TRACK=1. Details: https://github.com/bidah/native-sim#telemetry',
    );
    return id;
  }
}

export function commandName(command) {
  return COMMANDS.has(command) ? command : 'unknown';
}

// `flags` as parseArgs returns them: `{ minutes: 45, public: true, cache: false }`.
export function summarizeFlags(flags) {
  const out = {};
  for (const [name, value] of Object.entries(flags)) {
    if (name === '_positional' || !/^[a-z][a-z0-9-]{0,30}$/.test(name)) continue;
    out[`flag_${name}`] = typeof value === 'boolean' || VALUE_FLAGS.has(name) ? value : true;
  }
  return out;
}

export async function track(event, properties = {}) {
  if (!telemetryEnabled()) return;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: anonymousId(),
        properties: {
          ...properties,
          cli: 'native-sim',
          cli_version: pkg.version,
          os: process.platform,
          arch: process.arch,
          node_version: process.version,
          ci: Boolean(process.env.CI),
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Offline, blocked, timed out: none of it is the user's problem.
  }
}

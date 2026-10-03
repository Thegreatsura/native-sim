/** --dev selects Debug; --dev-url connects the simulator to local Metro. */
export function resolveDevelopment(flags, mode, framework = 'expo') {
  if (flags.dev && mode !== 'build') {
    throw new Error(
      '--dev requires build mode; it cannot be combined with --app, --app-file, --app-release, or --mode go',
    );
  }
  const url = validateDevUrl(flags['dev-url'], mode, framework);
  return { enabled: Boolean(flags.dev || url), url };
}

/** Validate framework-specific Expo links or React Native HTTPS tunnel origins. */
export function validateDevUrl(value, mode, framework = 'expo') {
  if (value === undefined) return '';
  if (mode !== 'build') {
    throw new Error(
      '--dev-url requires build mode; it cannot be combined with --app, --app-file, --app-release, or --mode go',
    );
  }
  try {
    if (typeof value !== 'string' || /\s/.test(value)) throw new Error();
    const link = new URL(value);
    if (framework === 'react-native') {
      if (
        link.protocol !== 'https:' ||
        !link.hostname ||
        (link.pathname !== '/' && link.pathname !== '') ||
        link.search ||
        link.hash
      ) {
        throw new Error();
      }
    } else if (!link.protocol.startsWith('exp+')) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(
      framework === 'react-native'
        ? '--dev-url for React Native CLI needs an HTTPS Metro tunnel origin, such as https://your-tunnel.example.'
        : '--dev-url for Expo needs the full development-client link from: npx expo start --dev-client --tunnel',
    );
  }
}

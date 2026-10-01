import { readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { join, basename, resolve, relative, isAbsolute, sep } from 'node:path';

/** Throws unless `cwd` looks like an Expo app. */
export function assertExpoProject(cwd) {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json in ${cwd} — run native-sim from an Expo project root.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.expo) {
    throw new Error(
      `${pkg.name ?? basename(cwd)} has no "expo" dependency. If this is a bare React Native CLI project, use --framework=react-native.`,
    );
  }
  return pkg;
}

/** Validate a plain React Native CLI app with checked-in iOS project files. */
export function assertReactNativeProject(cwd) {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json in ${cwd} — select a React Native CLI app with --project-dir.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) {
    throw new Error(`${pkg.name ?? basename(cwd)} has no "react-native" dependency.`);
  }
  if (deps.expo) {
    throw new Error(`${pkg.name ?? basename(cwd)} depends on "expo"; select --framework expo.`);
  }

  const ios = join(cwd, 'ios');
  if (!existsSync(join(ios, 'Podfile'))) {
    throw new Error('No ios/Podfile found — React Native CLI builds require checked-in iOS native files.');
  }
  const nativeProject = readdirSync(ios).some((name) =>
    name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'),
  );
  if (!nativeProject) {
    throw new Error('No .xcodeproj or .xcworkspace found in ios/ — this is not a complete React Native CLI iOS project.');
  }
  return pkg;
}

export function assertFrameworkProject(cwd, framework = 'expo') {
  if (framework === 'react-native') return assertReactNativeProject(cwd);
  return assertExpoProject(cwd);
}

/** Resolve an app directory without allowing it to escape the repository root. */
export function resolveProject(cwd, projectDir = '.') {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    throw new Error('--project-dir needs a directory relative to the repository root');
  }
  const path = projectDir.replace(/\\/g, '/');
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw new Error('--project-dir must be relative to the repository root');
  }

  let root;
  try {
    root = realpathSync(cwd);
  } catch {
    throw new Error(`Could not resolve repository root: ${cwd}`);
  }
  const candidate = resolve(root, path);
  const candidateRelative = relative(root, candidate);
  if (
    candidateRelative === '..' ||
    candidateRelative.startsWith(`..${sep}`) ||
    isAbsolute(candidateRelative)
  ) {
    throw new Error('--project-dir must stay inside the repository root');
  }
  let directory;
  try {
    directory = realpathSync(candidate);
  } catch {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  const rel = relative(root, directory);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('--project-dir must stay inside the repository root');
  }
  return { directory, relativePath: rel.split(sep).join('/') || '.' };
}

/** Best-effort read of app.json / app.config.json. Config plugins in JS are ignored. */
export function readAppConfig(cwd) {
  for (const file of ['app.json', 'app.config.json']) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8')).expo ?? {};
    } catch {
      return {};
    }
  }
  return {};
}


export function defaultRepoName(cwd) {
  return basename(cwd).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'expo-app';
}

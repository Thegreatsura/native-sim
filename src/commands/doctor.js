import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sh, has } from '../lib/proc.js';
import { assertFrameworkProject, resolveProject } from '../lib/project.js';
import { WORKFLOW_PATH, GATE_PATH } from './init.js';
import { green, red, yellow, dim, bold } from '../lib/ui.js';

const PASS = green('✓');
const FAIL = red('✗');
const WARN = yellow('!');

export async function doctor(cwd, flags = {}) {
  const checks = [];
  const add = (icon, label, detail) => checks.push(`  ${icon} ${label}${detail ? ` ${dim(detail)}` : ''}`);

  try {
    const project = resolveProject(cwd, flags['project-dir']);
    const framework = flags.framework ?? 'expo';
    const pkg = assertFrameworkProject(project.directory, framework);
    add(PASS, framework === 'expo' ? 'Expo project' : 'React Native CLI project', pkg.name);
  } catch (err) {
    add(FAIL, flags.framework === 'react-native' ? 'React Native CLI project' : 'Expo project', err.message.split('\n')[0]);
  }

  add(has('git') ? PASS : FAIL, 'git');

  if (!has('gh')) {
    add(FAIL, 'gh CLI', 'install from https://cli.github.com/');
  } else if (!sh('gh', ['auth', 'status']).ok) {
    add(FAIL, 'gh CLI authenticated', 'gh auth login');
  } else {
    const user = sh('gh', ['api', 'user', '-q', '.login']);
    add(PASS, 'gh CLI authenticated', user.out);
  }

  const [major] = process.versions.node.split('.').map(Number);
  add(major >= 20 ? PASS : FAIL, 'Node >= 20', `v${process.versions.node}`);

  add(existsSync(join(cwd, WORKFLOW_PATH)) ? PASS : WARN, WORKFLOW_PATH,
    existsSync(join(cwd, WORKFLOW_PATH)) ? '' : 'run native-sim init');
  add(existsSync(join(cwd, GATE_PATH)) ? PASS : WARN, GATE_PATH,
    existsSync(join(cwd, GATE_PATH)) ? '' : 'run native-sim init');

  const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner,visibility', '-q',
    '.nameWithOwner + " (" + .visibility + ")"'], { cwd });
  if (repo.ok) {
    const isPublic = /PUBLIC/.test(repo.out);
    add(isPublic ? PASS : WARN, 'GitHub remote', isPublic ? repo.out : `${repo.out} — macOS minutes bill at 10×`);
  } else {
    add(WARN, 'GitHub remote', 'none yet — native-sim up will create one');
  }

  console.log(`\n${bold('native-sim doctor')}\n`);
  console.log(checks.join('\n'));
  console.log('');
}

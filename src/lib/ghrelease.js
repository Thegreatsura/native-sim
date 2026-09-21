import { basename } from 'node:path';
import { statSync } from 'node:fs';
import { sh, shx } from './proc.js';
import { ensureArchive } from './r2.js';

/**
 * Host simulator builds as release assets on the repo the workflow runs in.
 *
 * The runner already has `GH_TOKEN: ${{ github.token }}`, and that token is
 * scoped to exactly this repo — so an asset here is fetchable with no PAT, no
 * third-party account, and no presigned URL to expire mid-session. A private
 * repo's assets are private for free, which is the thing R2 was buying.
 *
 * One stable tag is reused and the asset clobbered, rather than a release per
 * session, so the repo's release list does not fill with build noise.
 */
export const TAG = 'native-sim-build';

/**
 * The release is published, not a draft.
 *
 * A draft looks like the safer default — it is not listed publicly — but the
 * runner cannot read it. Draft releases are only returned to callers with push
 * access, and the workflow's job token is deliberately `contents: read`, so
 * `gh release download` 404'd on every `--app-file` run. Raising the job to
 * `contents: write` to fix that would hand write access to a job that also
 * opens a public tunnel, which is a far worse trade than publishing a release.
 *
 * On a private repo a published release is private anyway — the asset inherits
 * repo visibility, so nothing is given up. On a public repo it is genuinely
 * readable by anyone, so `up` warns and points at `--r2`.
 */
export function ensureRelease(cwd, repo) {
  const existing = sh('gh', [
    'release', 'view', TAG, '--repo', repo, '--json', 'isDraft', '-q', '.isDraft',
  ], { cwd });

  if (existing.ok) {
    // Repos set up by an earlier native-sim still carry a draft release, which
    // the runner cannot fetch from. Publish it rather than failing on the runner.
    if (existing.out.trim() === 'true') {
      shx('gh', ['release', 'edit', TAG, '--repo', repo, '--draft=false'], { cwd });
      return { created: false, published: true };
    }
    return { created: false, published: false };
  }

  shx('gh', [
    'release', 'create', TAG,
    '--repo', repo,
    '--title', 'native-sim builds',
    '--notes', 'Simulator builds uploaded by `native-sim`. Managed automatically; safe to delete.',
  ], { cwd });
  return { created: true, published: false };
}

/** Uploads (or replaces) one archive. Returns what the workflow needs to fetch it. */
export function upload(cwd, repo, filePath) {
  const archive = ensureArchive(filePath);
  const asset = basename(archive);
  ensureRelease(cwd, repo);
  // --clobber so re-running with the same build name replaces rather than fails.
  shx('gh', ['release', 'upload', TAG, archive, '--repo', repo, '--clobber'], { cwd });
  return { repo, tag: TAG, asset, bytes: statSync(archive).size };
}

/** True when the repo would expose this asset to anyone (published release on a public repo). */
export function isPubliclyReadable(cwd, repo) {
  const vis = sh('gh', ['repo', 'view', repo, '--json', 'visibility', '-q', '.visibility'], { cwd });
  if (!vis.ok || vis.out.trim().toUpperCase() !== 'PUBLIC') return false;
  const rel = sh('gh', ['release', 'view', TAG, '--repo', repo, '--json', 'isDraft', '-q', '.isDraft'], { cwd });
  return rel.ok && rel.out.trim() === 'false';
}

# native-sim

Push an Expo app (the default) or a plain React Native CLI app to GitHub, build it
on a GitHub-hosted macOS runner, and stream the live iOS Simulator back to your
browser through [`serve-sim`](https://github.com/bidah/serve-sim), our fork of [expo/serve-sim](https://github.com/expo/serve-sim).

```sh
cd my-expo-app
native-sim up --public --minutes 45

# Plain React Native CLI project
native-sim up --framework react-native --public --minutes 45
```

```
› Preparing repository
✓ committed on main
✓ pushed to bidah/my-expo-app
› Dispatching build
✓ run https://github.com/bidah/my-expo-app/actions/runs/1234567
⠹ Build and install the app (5/12)

  ● Simulator is live
  https://calm-river-1234.trycloudflare.com/?k=…
```

## What it does

1. `git init` / commit / push, creating the GitHub repo if there isn't one.
2. Dispatches `.github/workflows/native-sim.yml` with a session id and a one-time access key.
3. The runner boots a simulator and builds the selected framework's iOS app: Expo uses `expo prebuild`; React Native CLI uses checked-in iOS files. It installs and launches the app.
4. `serve-sim --detach` captures the simulator; a small auth gate fronts it; `cloudflared` opens a tunnel.
5. The runner publishes the URL as a **commit status** — the one GitHub surface readable *while a job is still running* (logs and artifacts only land after it ends).
6. The CLI polls for that status and opens your browser.

For how the stream reaches your browser and what keeps it alive, see
[docs/how-the-connection-works.md](docs/how-the-connection-works.md). To run an
already-built app from a repo containing no source, see
[docs/prebuilt-app-flow.md](docs/prebuilt-app-flow.md).

## Commands

| Command | |
|---|---|
| `native-sim up` | Push, build, stream. Runs `init` implicitly. |
| `native-sim init` | Write the workflow and auth gate into the project. |
| `native-sim status` | Current session, run state, stream URL. |
| `native-sim down` | Cancel the run — the stream and the runner stop together. |
| `native-sim doctor` | Check prerequisites. |
| `native-sim upload` | Upload a simulator build to R2, print a presigned URL. |
| `native-sim r2` | Configure R2 credentials (`--status` to inspect). |
| `native-sim turn` | Store TURN credentials as repo secrets, for `--transport webrtc`. |

### `native-sim up` options

| Flag | Default | |
|---|---|---|
| `--minutes <n>` | `30` | Stream lifetime. Max 350; GitHub kills hosted jobs at 6h. |
| `--device <name>` | `iPhone 17 Pro` | Falls back to the newest available iPhone. |
| `--mode <build\|app\|go>` | `build` | `app` installs a prebuilt archive and skips compiling entirely. `go` uses Expo Go — fast, but only for projects without custom native code. |
| `--framework <name>` | `expo` | `expo` or `react-native`. Expo remains the default. |
| `--project-dir <path>` | `.` | Selected app directory relative to the repository root. Also supported by `init` and `doctor`. |
| `--dev` | off | Build a Debug app for local Metro development. |
| `--dev-url <url>` | off | Expo: full dev-client link. React Native CLI: public HTTPS Metro tunnel URL. Implies `--dev`. |
| `--scheme <name>` | workspace name | Xcode scheme. |
| `--runner <label>` | `macos-26` | Must be arm64: `serve-sim` ships arm64-only native binaries. `macos-26`/`macos-latest` and `macos-15` are arm64; the `-large`/`-intel` labels are x64 and will not work. |
| `--codec <c>` | `mjpeg` | `mjpeg` is the only codec that works: `/stream.avcc` (h264) returns `200` and emits zero bytes on GitHub's macOS runners. |
| `--max-dimension <px>` | `900` | Caps captured width/height. Native (~1206×2622) is far more than the browser displays, and pixels cost encode CPU *and* bandwidth quadratically. `0` keeps native. |
| `--fps <n>` | `30` | MJPEG frame rate. serve-sim's own default is 60. |
| `--quality <n>` | `0.7` | MJPEG quality, 0.05–1. |
| `--agent` | off | Also expose an [agent-device](#driving-the-simulator-from-a-coding-agent) proxy so a coding agent can drive the simulator. |
| `--export` | off | Download the built `.app` archive (`--out <dir>`). |
| `--no-cache` | off | Force a full native rebuild. The build cache is **on by default**; this is an escape hatch for verifying a clean build or a suspected stale cache. |
| `--public` | off | Create the repo public. **Public repos get unlimited free Actions minutes.** |
| `--repo <name>` | directory name | Repo name when creating one. |
| `--no-open` | | Don't open the browser. |

### Framework selection

```sh
native-sim up
native-sim up --framework react-native
```

Omitting `--framework` selects Expo. `init` and `doctor` accept the same option
when validating the selected app. A React Native CLI project must declare
`react-native` and include its checked-in `ios/Podfile` and Xcode project; Expo
projects should use the default `--framework expo`.

## Monorepos

Run from the monorepo root and select the app directory:

```sh
native-sim doctor --project-dir apps/mobile
native-sim init --project-dir apps/mobile
native-sim up --project-dir apps/mobile
native-sim up --framework react-native --project-dir apps/native
```

The CLI pushes the root repository and writes the workflow and auth gate at that
root. Dependencies are installed using the root lockfile so workspace packages
remain available; framework build commands, native build caches, and exported
archives use the selected app directory. Supported root lockfiles include Bun,
pnpm, Yarn, and npm. Keep the generated workflow on the repository's default branch before
dispatching it from a feature branch.

## Fast Refresh from your computer

`--dev` and `--dev-url` build a Debug app instead of a Release app. Expo projects
need `expo-dev-client` (install it with `npx expo install expo-dev-client`). For a
React Native CLI app, `--dev` alone requires configuring a reachable Metro server
from the React Native Dev Menu; use `--dev-url` to set up the HTTPS tunnel proxy
automatically.

For Expo, enter a public Metro URL manually in the development launcher:

```sh
native-sim up --project-dir apps/mobile --dev
```

To open the app directly into a locally running Metro tunnel, start Metro in the
app directory and leave it running:

```sh
cd apps/mobile
npx expo start --dev-client --tunnel
```

Copy the complete development-client link printed by Expo (the `exp+...://` link,
including its encoded `url` query), then run from the repository root:

```sh
native-sim up --project-dir apps/mobile --dev-url "<development-client-link>"
```

For plain React Native CLI, pass the HTTPS URL from your Metro tunnel instead.
The workflow starts a Caddy reverse proxy on the runner at the simulator's
standard `localhost:8081` Metro address, forwarding to that HTTPS tunnel:

```sh
npx react-native start
# In another terminal, create a public HTTPS tunnel to local port 8081.
native-sim up --framework react-native --project-dir apps/native \
  --dev-url "https://your-metro-tunnel.example"
```

The tunnel must be reachable from the GitHub runner; localhost and LAN URLs will
not work. The app connects after installation, while JS and style edits use Fast
Refresh through your local Metro server. Keep Metro and the native-sim session
running. `--dev` and `--dev-url` apply only to build mode. Debug and Release builds
use separate caches; Release cache hits refresh Expo bundles with
`expo export:embed` and React Native CLI bundles with `react-native bundle`.

## Build caching (on by default)

The native build is the whole cost: **28.4 minutes** measured cold. Both Expo and
React Native CLI builds use [`@expo/fingerprint`](https://www.npmjs.com/package/@expo/fingerprint)
to hash native-build inputs while ignoring application JS. Framework, app
directory, and Debug/Release configuration are also part of the cache key.

On a Release cache hit the native build is skipped and the appropriate framework
bundler rewrites `main.jsbundle` inside the restored `.app`, so it runs your current
JavaScript. Debug builds use the live Metro connection instead.

| | Stream URL | App on screen |
|---|---|---|
| Cold cache | ~5 min | ~33 min |
| Warm cache | ~3 min | **7 min (measured)** |

Change JS → cache hit. Change a native dependency, manifest, or iOS project input →
fingerprint moves → full rebuild → new cache entry. Caches are 10 GB/repo and evict
after 7 days unused.

Requires no configuration and no agent involvement — it is part of the workflow.

## Running an already-built app

If you already have a simulator build, native-sim can skip compiling entirely:

```sh
native-sim up --app https://expo.dev/artifacts/eas/xxxx.tar.gz --public
```

**Your source is never pushed.** The repo holds only `.github/workflows/native-sim.yml`;
the runner downloads the archive, installs it, and streams it. This is the way to use a
free public repo without publishing private code — the code simply never goes there.

Requirements:

- **It must be a *simulator* build**, not a device build. A device `.ipa` cannot run on a
  simulator; the workflow checks `CFBundleSupportedPlatforms` and fails with a clear
  message rather than a confusing `simctl` error. With EAS, that means a profile with
  `ios.simulator: true`.
- **The URL must be reachable by the runner.** A local path cannot work — the runner
  cannot reach your machine. EAS build URLs, release assets, or any `https://` link are
  fine. Signed URLs expire, so fetch a fresh one per session.
- `.tar.gz` or `.zip` containing the `.app`.

### Choosing where builds live

Two things decide who can download your build: **where it is hosted**, and — for the
default backend — **whether the repo is public**. Those axes interact, and the useful
combinations are:

| Repo | Hosting | Your build is | macOS minutes |
| --- | --- | --- | --- |
| private | GitHub release *(default)* | private | bill at [**10×**](#cost) |
| public | GitHub release *(default)* | **downloadable by anyone** | free, unlimited |
| public | `--r2` | private — 2h signed URL | free, unlimited |

That last row is the reason `--r2` exists. A public repo is what makes macOS minutes free
and unlimited, and the default backend inherits *repo* visibility — so on a public repo it
publishes your binary. R2 is the only combination that keeps both the free minutes and a
private build. The cost is a Cloudflare account and the `aws` CLI.

If you are already on a private repo, the default backend is private too and `--r2` buys
you nothing.

### Hosting your own builds

By default a local build is uploaded as an asset on a **release of the same repo the
workflow runs in**, and the runner fetches it with the job's own `GITHUB_TOKEN`:

```sh
native-sim up --app-file ./MyApp.app          # upload + run in one step
native-sim upload ./MyApp.app                 # just upload
native-sim up --app-release MyApp.app.tar.gz  # run something already uploaded
```

This needs no third-party account and no credentials file. It works for **public and private
repos alike**: a private repo's release assets are readable only by people who can read the
repo, and there is no signed URL to expire mid-session.

The release is **published, not a draft**. GitHub only shows draft releases to callers with
push access, and the workflow job runs with `contents: read` on purpose — so a draft is
something the runner cannot fetch at all. Granting the job `contents: write` to work around
that would give repo write access to a job that also opens a public tunnel, which is a worse
trade than publishing a release.

What that means for you:

- **Private repo** — nothing changes. Release assets inherit repo visibility, so the build is
  readable only by people who can already read the repo.
- **Public repo** — the asset *is* downloadable by anyone, and the CLI warns you when it
  uploads. Use [`--r2`](#hosting-on-r2-instead) to keep the build private — see
  [Choosing where builds live](#choosing-where-builds-live).

All builds land on one reused tag, `native-sim-build`, with the asset clobbered each time,
so the release list does not fill up with build noise. Deleting that release is safe.

### Hosting on R2 instead

Pass `--r2` when the build must live outside the repo entirely. native-sim puts it on
Cloudflare R2 and hands the runner a **presigned** URL:

```sh
native-sim r2                                  # one-time: account, bucket, API token
native-sim upload ./MyApp.app --r2             # prints a presigned URL
native-sim up --app-file ./MyApp.app --r2      # upload + run in one step
```

The bucket stays **private**; the runner gets a time-limited signed URL (2h via
`--app-file`, `--expires` on `upload`). This matters — a public bucket would leave your
build permanently downloadable by anyone who found the key.

A `.app` directory is tarred automatically. Credentials live in `~/.native-sim/r2.json`
(mode 0600) or the `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` environment variables, which take precedence. Create the API
token at **dash.cloudflare.com → R2 → Manage API Tokens** with Object Read & Write.
Uses the `aws` CLI against R2's S3-compatible API.

Getting an EAS build URL:

```sh
eas build:list --platform ios --limit 5 --json --non-interactive \
  | jq -r '.[0].artifacts.applicationArchiveUrl'
```

## Driving the simulator from a coding agent

`--agent` runs an [`agent-device`](https://agent-device.dev/) proxy next to the simulator,
reachable at `<url>/agent-device` on the **same tunnel and the same key** as the stream. A
coding agent on your machine can then tap, type, scroll and read the accessibility tree of
an app running on a GitHub runner — while you watch the same session in a browser.

The runner is a Mac with simulator access for the length of your session, which is exactly
the topology `agent-device proxy` is built for.

### Setup

```sh
npm install -g agent-device        # once; 0.20.0 or newer
native-sim up --public --agent
```

The runner installs **the same agent-device version you have locally** (native-sim reads
`agent-device --version` and pins it), because the client and the proxied daemon should
match. When the session comes up, the CLI prints the connect command with the URL and key
already filled in:

```
  Drive it from an agent (agent-device)

  agent-device connect proxy \
    --daemon-base-url https://<tunnel>.trycloudflare.com/agent-device \
    --daemon-auth-token <key>
```

### Using it

```sh
agent-device connect proxy --daemon-base-url <url>/agent-device --daemon-auth-token <key>

agent-device devices --platform ios                      # confirm the runner's simulator
agent-device open com.your.bundle.id --platform ios --device "iPhone 17 Pro"
agent-device snapshot -i                                 # interactive elements + refs
agent-device press 'label="Explore"' --settle            # a real touch injection
agent-device scroll down

agent-device close                                       # ALWAYS close before disconnect
agent-device disconnect
```

A real session looks like this — note the session state path is on the runner, not your Mac:

```
Opened: com.anonymous.my-app
Session state: /Users/runner/.agent-device/sessions/proxy_adc-e8554d

Tapped label="Explore" (244, 822)
settled after 1003ms: +15 -10 (~5 unchanged)
```

### Gotchas worth knowing before you hit them

- **`connect proxy` succeeds even against a dead daemon.** It allocates no device lease
  until `open`, so a broken session only surfaces on your first real command as
  `Remote daemon is unavailable`. Check first:

  ```sh
  curl -H "Authorization: Bearer <key>" "<url>/agent-device/health"
  # want: {"ok":true,...,"upstream":{"ok":true,...}}
  # a proxy with a dead daemon answers HTTP 200 with {"ok":false,"error":"fetch failed"}
  ```

  That `200` matters: `curl -f` scores it a success, so a naive health check will not
  catch it.

- **`close` before `disconnect`, and never delete the client state dir mid-session.** The
  state dir holds the session's ownership credentials. Delete it and the runner keeps the
  device claimed by an orphaned session; `open` then fails `DEVICE_IN_USE` and there is no
  way back — `--force` does not cover device claims. The only fix is a new session.

- **A fresh tunnel hostname takes up to a minute to resolve.** Quick-tunnel names are
  created seconds before you get them, and a resolver that answers `NXDOMAIN` may cache
  that negative answer. If DNS fails immediately after a session starts, wait and retry.

- **The first snapshot needs an XCTest runner.** The workflow builds it during the session
  (`agent-device prepare ios-runner`), which takes several minutes cold and seconds on a
  cache hit. It runs *after* the stream URL is published, so it delays agent-readiness,
  not the stream.

### What the workflow sets, and why

Three agent-device defaults assume a developer laptop and are wrong for a single-tenant
runner that is destroyed when the job ends:

| Setting | Default | native-sim | Why |
|---|---|---|---|
| `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS` | 5 min | `0` | The daemon reaps itself 5 minutes after the last command, and health probes do not count as activity — so it is usually gone before the agent ever connects. |
| `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` | 5 min | `0` | Same, for the XCTest runner. |
| `AGENT_DEVICE_LEASE_TTL_MS` | 5 min | job cap | The device lease taken by `open` expires, after which every command fails `UNAUTHORIZED`. |

Nothing leaks by disabling these: the hold loop *is* the session, and the VM dies with it.

The hold loop also **supervises the daemon** — any time `/health` is not `ok:true` it
restarts the proxy, at most once a minute. The daemon has died from an idle reap and from
a killed `xcodebuild`, so the session is built to outlive any single daemon rather than to
enumerate causes.

## Stopping a session

```sh
native-sim down          # cancel the most recent session
native-sim down --all    # cancel every native-sim run still in flight
```

`down` reads `.git/native-sim-session.json`, which every `native-sim up` overwrites — so it
only knows the **latest** session. If you have started several, plain `down` will miss
the older ones; it warns when it detects others and `--all` catches them. You can also
cancel by id, or use the repo's Actions tab:

```sh
gh run cancel <run-id> -R <owner>/<repo>
```

Two things worth knowing:

- **Cancelling kills the stream instantly.** The VM is destroyed, `cloudflared` dies with
  it, and the URL stops resolving immediately. There is no graceful drain, and the URL
  can never be revived.
- **Sessions stop by themselves** when the hold loop reaches `--minutes`. Nothing leaks
  if you do nothing. Cancelling only reclaims a runner sooner — you are capped at 5
  concurrent macOS jobs — or frees your attention. On a public repo, letting them expire
  costs no minutes.

## Stream smoothness

Choppiness is usually one of three things, in this order:

1. **Quality and resolution.** `--quality` and `--max-dimension` are the real levers.
   Measured on a live session, going from serve-sim's defaults (60fps / q0.7 / 900px) to
   24fps / q0.5 / 640px cut bandwidth **2.4×**, from 1.25 to 0.52 Mbit/s — and lower
   resolution is reported to feel *more responsive*, because smaller frames spend less
   time on the wire. native-sim ships **900px / q0.7 / 30fps**: 640 was measurably snappier
   but visibly soft on a retina display, where the preview is drawn at roughly 2× CSS
   pixels. Drop to `--max-dimension 640 --quality 0.5` if you want responsiveness over
   detail.

   Note this does **not** fix latency. Measured round trip through a quick tunnel to a US
   runner from Santiago is 320–550 ms, of which only ~45 ms is reaching Cloudflare. Smaller
   frames stop *adding* to that; only a closer runner reduces it.
2. **Frame rate — but mind which one.** serve-sim defaults MJPEG to **60 fps**, and
   `serve-sim --video-fps` only sets the *h264* rate. native-sim's `--fps` now sets
   `--mjpeg-fps`, which is the stream that actually runs.
3. **Not the codec.** `/stream.avcc` (H.264) returns `200` and then emits **zero bytes**
   on GitHub's macOS runners, reproducibly. The browser is pointed at `.mjpeg` regardless,
   so `--codec h264` changes nothing. Default is `mjpeg`.
4. **CPU contention.** Encoding is CPU-bound and the runner has 3 cores. A cold
   `xcodebuild` running alongside the stream can saturate it hard enough that the tunnel
   returns `530`. A warm build cache removes the build entirely.

**WebRTC is available but is not the default, and did not help here.** In theory its
congestion control should beat MJPEG over a long link. Tested against Cloudflare Realtime
TURN from Santiago to a US runner, it was not noticeably better — and TURN is a **paid,
per-GB relay**, so every session costs money while it runs. Reach for it only if plain
HTTP is failing you.

A quick tunnel carries no UDP, so **TURN is mandatory** for WebRTC; STUN alone cannot
traverse it.

```sh
native-sim turn                              # store TURN creds as repo secrets
native-sim up --transport webrtc --public
```

Credentials go in **repo secrets**, never workflow inputs — dispatch inputs are visible
to anyone who can read the repo, which on a public repo is everyone. Cloudflare Realtime,
Twilio, Metered, or self-hosted coturn all work. `native-sim turn --status` shows what is set.

## Access control

`serve-sim` has no authentication, so a bare tunnel would hand simulator control
to anyone who found the URL. `native-sim` generates a per-session key and the runner
puts `.github/native-sim/gate.cjs` — a dependency-free reverse proxy — in front of it.
The key is accepted once from `?k=`, traded for an `HttpOnly` cookie, and required
on every request *and* on the control-WebSocket upgrade.

It is still a shareable bearer link. Anyone you send it to can drive the simulator.

**On a public repo, never publish the key anywhere GitHub exposes.** Commit statuses are
world-readable with no authentication, so the runner publishes only the bare tunnel URL;
the CLI appends the key it generated locally. Job logs and step summaries require auth,
but treat them the same way.

## Cost

**Public repos are free and unlimited.** This is the whole reason native-sim is viable;
`--public` is not a detail.

Private repos bill macOS at **$0.062/min**, and against included minutes macOS carries a
**10× multiplier** — so one hour of streaming consumes 600 quota minutes, or $3.72 once
you are past your allowance. (Linux is $0.006/min for comparison.)

| Plan | Included/mo | One hour costs | macOS hours/mo |
|---|---|---|---|
| Free | 2,000 | 30% of the month | ~3.3 h |
| Pro / Team | 3,000 | 20% | 5 h |
| Enterprise | 50,000 | 1.2% | ~83 h |

A **cold build alone** is ~28 min — $1.74, or 280 quota minutes, before you see a single
frame. A warm cache reduces that to ~1 min, so on private repos the build cache is most
of the bill rather than a convenience.

`native-sim` warns when the repo is private. Free/Pro/Team also cap concurrent macOS jobs
at 5.

Rates verified against GitHub's billing docs; they change, so re-check before relying on
them.

## Limits worth knowing

- **Ephemeral.** The runner VM is destroyed when the job ends. There is no persistent simulator.
- **6 hours, hard.** GitHub kills hosted jobs at 360 minutes.
- **MJPEG over a tunnel**, not WebRTC. WebRTC needs a UDP path a quick tunnel can't provide without TURN; pass `--turn-url` to `serve-sim` in the workflow if you have one.
- **A small box.** Standard runners are ~3 vCPU / 7 GB running Xcode, a simulator, and a video encoder. During a *cold* build, `xcodebuild` and the video capture compete for those 3 cores, which shows up as `control socket connect timeout` and "connecting" churn in the preview. A warm cache avoids the build entirely and the stream stays smooth.
- **GitHub's Actions terms** cover building, testing and publishing *the software in that repo*. Occasional PR-preview sessions fit; a 24/7 public simulator host does not, and GitHub reserves the right to throttle it.

If you want this often, a Mac mini as a self-hosted runner is cheaper and faster
than fighting the constraints.

## Requirements

- `gh` CLI, authenticated (`gh auth login`)
- Node 20+
- An Expo project (`expo` in `package.json`)

## Telemetry

native-sim sends anonymous usage stats to [PostHog](https://posthog.com), so we
know which commands and options people rely on:

- the command (`up`, `down`, `upload`, …), and whether it failed and after how long
- the flags you passed. `--framework`, `--mode`, `--transport`, `--codec`, `--device` and the
  numeric options are sent by value; on/off flags as `true`/`false`; everything
  else (`--repo`, `--app`, `--app-file`, `--project-dir`, `--dev-url`, `--message`, …)
  only as `true`, never by value
- the native-sim version, OS, CPU architecture, Node version and whether it ran in CI
- a random ID created on first run in `~/.config/native-sim/telemetry.json`

Nothing from your project, repository, GitHub account, credentials or stream is
sent. Opt out with `DO_NOT_TRACK=1` or `NATIVE_SIM_TELEMETRY_DISABLED=1`.
Requests are capped at 1.5 seconds and never change a command's output or exit
code.

## License

MIT

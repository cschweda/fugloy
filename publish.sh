#!/usr/bin/env bash
set -euo pipefail

# Fugløy publish script: npm releases of the @fugloy packages, in two steps.
#
# Usage:
#   ./publish.sh check <set>       run every check and stage the release; publishes nothing
#   ./publish.sh publish [--otp <code>]
#                                  publish what `check` staged, then tag and push the tag
#   ./publish.sh status            show what is staged
#
# <set> is one of:
#   core   @fugloy/z80, @fugloy/disasm, @fugloy/cli, released together at one version
#          (disasm depends on z80, cli on both, so they publish in that order)
#   emu    @fugloy/emu, versioned on its own (0.x)
#   mcp    @fugloy/mcp, versioned on its own (0.x). It depends on @fugloy/emu (and the core's
#          disasm and z80), so publish emu first: `check mcp` refuses unless the emu version it
#          needs is on npm or staged, and only stages mcp once that emu is on npm.
#
# The version is whatever the packages' package.json files say: bump it, and add its CHANGELOG.md
# entry, in an ordinary commit on main first (`## [1.1.0]` for core, `## [emu 0.2.0]` for emu,
# `## [mcp 0.1.0]` for mcp), as "p4: release 1.0.0" did. The script never edits a package.json.
#
# Why two steps: npm asks every publish for a fresh two-factor code, which lasts about 30 seconds,
# and the checks take minutes. `check` does all the slow work: it checks the tree and CI, installs,
# typechecks, tests, builds, packs each package into .release/, installs the packed tarballs in a
# scratch project and runs them, and dry-runs the publish. `publish` then only verifies that nothing
# has changed since (same commit, clean tree, same tarball hashes) and publishes those exact
# tarballs, so a code given to it is used within seconds. Without --otp it asks for the code; with
# it (`./publish.sh publish --otp 123456`) it runs unattended, which is how an agent publishes when
# you hand it a code.
#
# `check` makes sure that:
#   - you're in the Fugløy root, on main, up to date with origin/main, with a clean tree;
#   - you're logged in to npm, and no package of the set already has this version on npm;
#   - the set's packages share one version (core) and CHANGELOG.md has its entry;
#   - CI finished and passed for this commit (needs the GitHub CLI, logged in);
#   - typecheck, tests, and build pass, and then, alone, Sea Dragon's speed benchmark (FUGLOY_BENCH=1,
#     the emu's ≥ 20× real time; it skips without the Model III ROM in fugloy.mcp.json);
#   - every runtime dependency is another @fugloy package of the same release (no third-party code),
#     except in the mcp set, whose @fugloy dependencies are ^ ranges on the local versions (which
#     must be on npm, or emu staged) and whose third-party ones (the MCP SDK, zod) are exact versions;
#   - each tarball holds package.json, README.md, LICENSE, and only the files its "files" field
#     names, has no workspace: specifiers left, and installs and runs from a scratch project.
# If a publish stops part way (a code expired after the first package), run `publish` again with a
# new code: packages already on npm at this version are skipped.

BRANCH="main"
STAGE=".release"
CORE_PACKAGES=(z80 disasm cli)
EMU_PACKAGES=(emu)
MCP_PACKAGES=(mcp)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info() { echo -e "${GREEN}[fugloy]${NC} $1"; }
warn() { echo -e "${YELLOW}[fugloy]${NC} $1"; }
error() { echo -e "${RED}[fugloy]${NC} $1" >&2; }
die() {
  error "$1"
  exit 1
}

usage() {
  sed -n '4,19p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# Read a field of a package.json with Node (CommonJS forced, the root being "type": "module").
pkg_field() {
  node --input-type=commonjs -e "const v = require('./packages/$1/package.json').$2; console.log(v === undefined ? '' : v)"
}

# The @fugloy packages a package depends on at run time, as folder names (emu, disasm, z80), in FUGLOY_DEPS.
read_fugloy_deps() {
  FUGLOY_DEPS=()
  local d
  while IFS= read -r d; do [[ -z "$d" ]] || FUGLOY_DEPS+=("$d"); done < <(node --input-type=commonjs -e '
    const deps = require("./packages/" + process.argv[1] + "/package.json").dependencies || {};
    for (const n of Object.keys(deps)) if (n.startsWith("@fugloy/")) console.log(n.slice(8));
  ' "$1")
}

# The staged tarball of name@version, if `check emu` staged it at this commit and it is unchanged
# since; else nothing. Always returns 0, so a miss never stops the script under set -e.
staged_tarball() {
  local name="$1" version="$2"
  [[ -f "$STAGE/manifest" ]] || return 0
  [[ "$(sed -n 's/^set=//p' "$STAGE/manifest")" == emu ]] || return 0
  [[ "$(sed -n 's/^commit=//p' "$STAGE/manifest")" == "$(git rev-parse HEAD)" ]] || return 0
  [[ "$(sed -n 's/^version=//p' "$STAGE/manifest")" == "$version" ]] || return 0
  local e
  while IFS= read -r e; do
    local t="${e% *}" sum="${e##* }"
    [[ -f "$t" && "$(shasum -a 256 "$t" | cut -d' ' -f1)" == "$sum" ]] || continue
    [[ "$(tar -xzOf "$t" package/package.json | node --input-type=commonjs -e 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(p.name + "@" + p.version)')" == "$name@$version" ]] && { echo "$PWD/$t"; return 0; }
  done < <(sed -n 's/^tarball=//p' "$STAGE/manifest")
  return 0
}

# The mcp smoke test: start `npx fugloy-mcp` over a pipe and check that it answers initialize (its
# name and version) and tools/list (the tools of every phase), printing nothing but JSON-RPC.
MCP_SMOKE='
import { spawn } from "node:child_process";
const version = process.argv[1];
const child = spawn("npx", ["--no-install", "fugloy-mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const done = (code, text) => { child.removeAllListeners("exit"); child.kill(); (code ? console.error : console.log)(text); process.exit(code); };
const timer = setTimeout(() => done(1, "fugloy-mcp did not answer within 20 s"), 20_000);
child.on("exit", (code) => done(1, "fugloy-mcp exited (" + code + ") before answering"));
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  for (let i; (i = buf.indexOf("\n")) >= 0; ) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { done(1, "fugloy-mcp printed a line that is not JSON-RPC: " + line); }
    if (msg.id === 1) {
      const info = msg.result && msg.result.serverInfo;
      if (!info || info.name !== "fugloy-mcp" || info.version !== version) done(1, "initialize answered " + line);
      send({ method: "notifications/initialized" });
      send({ id: 2, method: "tools/list" });
    } else if (msg.id === 2) {
      const names = ((msg.result && msg.result.tools) || []).map((t) => t.name);
      for (const n of ["load", "run", "screen", "break", "label", "suggest", "snapshot", "search"])
        if (!names.includes(n)) done(1, "tools/list has no " + n + ": " + names.join(" "));
      clearTimeout(timer);
      done(0, "npx fugloy-mcp answered initialize (fugloy-mcp " + version + ") and tools/list (" + names.length + " tools).");
    }
  }
});
send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fugloy-publish", version } } });
'

SCRATCH=""
REHEARSAL=""
cleanup() {
  [[ -z "$SCRATCH" ]] || rm -rf "$SCRATCH"
  [[ -z "$REHEARSAL" ]] || rm -rf "$REHEARSAL"
}
trap cleanup EXIT

# ─── Shared preflight ───────────────────────────────────────────────

preflight() {
  [[ -f pnpm-workspace.yaml && -d packages/disasm ]] || die "Run this from the Fugløy root."
  command -v pnpm >/dev/null || die "pnpm is required."
  local current
  current=$(git rev-parse --abbrev-ref HEAD)
  [[ "$current" == "$BRANCH" ]] || die "Publish from $BRANCH (you're on $current)."
  if [[ -n "$(git status --porcelain)" ]]; then
    git status --short
    die "Uncommitted changes. Commit or stash them first."
  fi
  info "Checking that $BRANCH is up to date with origin..."
  git fetch --quiet origin "$BRANCH" --tags
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] ||
    die "$BRANCH and origin/$BRANCH differ. Pull or push first."
  npm whoami >/dev/null 2>&1 || die "Not logged in to npm. Run: npm login"
  info "npm user: $(npm whoami)"
}

# ─── check ──────────────────────────────────────────────────────────

cmd_check() {
  local set="${1:-}"
  local packages=()
  case "$set" in
    core) packages=("${CORE_PACKAGES[@]}") ;;
    emu) packages=("${EMU_PACKAGES[@]}") ;;
    mcp) packages=("${MCP_PACKAGES[@]}") ;;
    *) usage 1 ;;
  esac
  preflight

  # One version for the set, not yet on npm.
  local version=""
  for p in "${packages[@]}"; do
    local name v
    name=$(pkg_field "$p" name)
    v=$(pkg_field "$p" version)
    [[ "$name" == "@fugloy/$p" ]] || die "packages/$p/package.json is $name, not @fugloy/$p."
    [[ -z "$version" || "$v" == "$version" ]] || die "The $set packages disagree on the version ($version, and $v in $p). Release them at one version."
    version="$v"
    [[ "$(pkg_field "$p" private)" != "true" ]] || die "$name is private."
    if npm view "$name@$v" version >/dev/null 2>&1; then
      die "$name@$v is already on npm. Bump the version (and CHANGELOG.md) in a commit first."
    fi
  done
  info "Releasing $set at $version: ${packages[*]/#/@fugloy/}"

  local heading="$version" tag="v$version"
  if [[ "$set" != core ]]; then heading="$set $version"; tag="$set-v$version"; fi
  grep -qF "## [$heading]" CHANGELOG.md || die "CHANGELOG.md has no '## [$heading]' entry. Add one (move items out of [Unreleased])."
  info "CHANGELOG.md has an entry for $heading."
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null &&
    [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
    die "Tag $tag already exists on another commit."
  fi

  # The mcp set's @fugloy dependencies must already be on npm at the local versions, or staged
  # (emu, by `check emu`, not yet published). In the second case the check is a rehearsal: it runs
  # everything with the staged tarball but stages nothing, so emu's staging is kept for `publish`.
  local deps_staged=()
  if [[ "$set" == mcp ]]; then
    read_fugloy_deps mcp
    for dep in "${FUGLOY_DEPS[@]}"; do
      local dname="@fugloy/$dep" dver
      dver=$(pkg_field "$dep" version)
      if npm view "$dname@$dver" version >/dev/null 2>&1; then
        info "$dname@$dver is on npm."
      else
        local staged
        staged=$(staged_tarball "$dname" "$dver")
        [[ -n "$staged" ]] || die "@fugloy/mcp needs $dname@$dver, which is neither on npm nor staged. Publish ${dep} first (./publish.sh check emu, then ./publish.sh publish)."
        warn "$dname@$dver is staged ($staged) but not on npm: this check is a rehearsal and stages nothing."
        deps_staged+=("$staged")
      fi
    done
  fi

  # CI for this commit: only a run that finished and passed counts.
  command -v gh >/dev/null && gh auth status >/dev/null 2>&1 || die "The GitHub CLI isn't installed or isn't logged in; it is needed to check CI."
  local ci
  ci=$(gh run list --commit "$(git rev-parse HEAD)" --workflow ci.yml --limit 1 \
    --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null || true)
  [[ "$ci" == "completed success" ]] || die "CI hasn't passed for this commit (${ci:-no run found})."
  info "CI passed for this commit."

  info "Installing, typechecking, testing, building..."
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm test
  # The benchmark is opt-in: beside the rest of the parallel suite it measures well under what it
  # gets alone, so it runs here by itself, once the suite is done.
  FUGLOY_BENCH=1 pnpm exec vitest run packages/emu/test/integration/benchmark.test.js
  pnpm clean
  pnpm build
  [[ -z "$(git status --porcelain)" ]] || {
    git status --short
    die "The checks or the build changed the tree."
  }

  # Pack each package with pnpm, which turns workspace:* into the real version and applies
  # publishConfig, then look inside.
  local dest="$STAGE"
  if [[ ${#deps_staged[@]} -gt 0 ]]; then
    REHEARSAL=$(mktemp -d)
    dest="$REHEARSAL"
  else
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
  fi
  local tarballs=() dest_abs
  dest_abs=$(cd "$dest" && pwd)
  for p in "${packages[@]}"; do
    local tgz
    tgz=$(cd "packages/$p" && pnpm pack --pack-destination "$dest_abs" | tail -1)
    tgz="$dest/$(basename "$tgz")"
    [[ -f "$tgz" ]] || die "pnpm pack made no tarball for $p."
    check_tarball "$set" "$p" "$tgz" "$version"
    tarballs+=("$tgz")
  done

  # Install the tarballs together in a scratch project, as a user would, and run them.
  info "Installing the packed tarballs in a scratch project..."
  SCRATCH=$(mktemp -d)
  local abs=()
  for t in "${tarballs[@]}" ${deps_staged[@]+"${deps_staged[@]}"}; do [[ "$t" == /* ]] && abs+=("$t") || abs+=("$PWD/$t"); done
  (
    cd "$SCRATCH"
    npm init -y >/dev/null
    npm install --ignore-scripts --no-audit --no-fund "${abs[@]}" >/dev/null
  ) || die "The packed tarballs didn't install."
  smoke_test "$set" "$version"

  # Dry-run each publish.
  for t in "${tarballs[@]}"; do
    npm publish "$t" --dry-run --access public --ignore-scripts >/dev/null 2>&1 || die "npm publish --dry-run failed for $t."
  done
  info "npm publish --dry-run passed for every tarball."

  if [[ ${#deps_staged[@]} -gt 0 ]]; then
    info "Every check passed with the staged ${deps_staged[*]}, but $set is not staged: publish that first (./publish.sh publish), wait for npm to show it, then run ./publish.sh check $set again."
    return
  fi

  # Record what was checked, for `publish` to verify.
  {
    echo "set=$set"
    echo "version=$version"
    echo "tag=$tag"
    echo "commit=$(git rev-parse HEAD)"
    for t in "${tarballs[@]}"; do echo "tarball=$t $(shasum -a 256 "$t" | cut -d' ' -f1)"; done
  } >"$STAGE/manifest"

  local last
  last=$(git describe --tags --abbrev=0 --match "$([[ $set == core ]] && echo 'v*' || echo "$set-v*")" 2>/dev/null || true)
  if [[ -n "$last" ]]; then
    info "Commits since $last that touch the set:"
    git log --format='  %h  %an  %s' "$last"..HEAD -- "${packages[@]/#/packages/}" |
      node --input-type=commonjs -e '
        const text = require("fs").readFileSync(0, "utf8");
        const shown = (c) => "\\u{" + c.codePointAt(0).toString(16) + "}";
        process.stdout.write(text.replace(/(?![\n\t])[\p{Cc}\p{Cf}\u{2028}\u{2029}]/gu, shown));
      '
  fi
  info "Staged $set $version in $STAGE/. Publish with: ./publish.sh publish (asks for npm's code) or ./publish.sh publish --otp <code>"
}

check_tarball() {
  local set="$1" p="$2" tgz="$3" version="$4"
  local files
  files=$(tar -tzf "$tgz" | sed 's|^package/||')
  for required in package.json README.md LICENSE; do
    grep -qx "$required" <<<"$files" || die "@fugloy/$p's tarball is missing $required."
  done
  # Only what "files" names (plus what npm always adds) may be in it.
  local allowed
  allowed=$(node --input-type=commonjs -e '
    const pkg = require("./packages/" + process.argv[1] + "/package.json");
    const keep = [...(pkg.files || []), ...Object.values(pkg.bin || {}).map((b) => b.replace(/^\.\//, ""))];
    console.log(keep.map((f) => "^" + f.replace(/[.]/g, "\\.") + "(/|$)").join("|"));
  ' "$p")
  local unexpected
  unexpected=$(grep -vE "^(package\.json|README\.md|LICENSE|CHANGELOG\.md)$" <<<"$files" | grep -vE "$allowed" || true)
  [[ -z "$unexpected" ]] || die "@fugloy/$p's tarball holds files it shouldn't:"$'\n'"$unexpected"
  # Dependencies: only @fugloy packages, at exactly this release's version. The mcp set instead
  # names its @fugloy dependencies as ^ the local version, and pins its third-party ones exactly.
  local bad
  bad=$(tar -xzOf "$tgz" package/package.json | node --input-type=commonjs -e '
    const pkg = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const [version, set] = process.argv.slice(1);
    const out = [];
    if (pkg.version !== version) out.push("version is " + pkg.version);
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
      if (set === "mcp") {
        if (name.startsWith("@fugloy/")) {
          const local = require("./packages/" + name.slice(8) + "/package.json").version;
          if (spec !== "^" + local) out.push(name + " is " + spec + ", not ^" + local);
        } else if (!/^\d+\.\d+\.\d+$/.test(spec)) out.push("third-party dependency " + name + " is " + spec + ", not an exact version");
      } else if (!name.startsWith("@fugloy/")) out.push("third-party dependency " + name);
      else if (spec !== version) out.push(name + " is " + spec + ", not " + version);
    }
    if (JSON.stringify(pkg).includes("workspace:")) out.push("a workspace: specifier is left");
    console.log(out.join("\n"));
  ' "$version" "$set")
  [[ -z "$bad" ]] || die "@fugloy/$p's packed package.json is wrong:"$'\n'"$bad"
  info "@fugloy/$p: $(wc -l <<<"$files" | tr -d ' ') files, nothing unexpected."
}

smoke_test() {
  local set="$1" version="$2"
  (
    cd "$SCRATCH"
    if [[ "$set" == core ]]; then
      local printed
      printed=$(npx --no-install fugloy --version)
      [[ "$printed" == *"$version"* ]] || { echo "fugloy --version printed '$printed', expected $version" >&2; exit 1; }
      cp "$OLDPWD/examples/sea-dragon/seadrg01.cmd" .
      npx --no-install fugloy seadrg01.cmd >listing.txt
      grep -q "ENTRY\|ORG\|; entry" listing.txt || { echo "fugloy printed no listing for Sea Dragon" >&2; exit 1; }
      node --input-type=module -e 'import { decode } from "@fugloy/z80"; import { openProgram } from "@fugloy/disasm"; if (typeof decode !== "function" || typeof openProgram !== "function") process.exit(1);'
    elif [[ "$set" == emu ]]; then
      node --input-type=module -e 'import { Machine, COVERAGE } from "@fugloy/emu"; if (typeof Machine !== "function" || COVERAGE.EXEC !== 1) process.exit(1);'
    else
      # The server over a pipe, as an MCP client starts it: initialize, then tools/list.
      echo '{ "roms": {} }' >fugloy.mcp.json
      FUGLOY_CONFIG="$PWD/fugloy.mcp.json" node --input-type=module -e "$MCP_SMOKE" "$version"
    fi
  ) || die "The packed tarballs installed but didn't run."
  info "The packed tarballs install and run."
}

# ─── publish ────────────────────────────────────────────────────────

cmd_publish() {
  local otp=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --otp) otp="${2:-}"; shift 2 ;;
      --otp=*) otp="${1#--otp=}"; shift ;;
      *) die "Unknown argument '$1'. Usage: ./publish.sh publish [--otp <code>]" ;;
    esac
  done
  [[ -f "$STAGE/manifest" ]] || die "Nothing staged. Run ./publish.sh check <set> first."
  preflight
  local set version tag commit
  set=$(sed -n 's/^set=//p' "$STAGE/manifest")
  version=$(sed -n 's/^version=//p' "$STAGE/manifest")
  tag=$(sed -n 's/^tag=//p' "$STAGE/manifest")
  commit=$(sed -n 's/^commit=//p' "$STAGE/manifest")
  [[ "$commit" == "$(git rev-parse HEAD)" ]] || die "HEAD moved since the check (staged at ${commit:0:7}). Run ./publish.sh check $set again."
  local entries=()
  while IFS= read -r line; do entries+=("$line"); done < <(sed -n 's/^tarball=//p' "$STAGE/manifest")
  for e in "${entries[@]}"; do
    local t="${e% *}" sum="${e##* }"
    [[ -f "$t" && "$(shasum -a 256 "$t" | cut -d' ' -f1)" == "$sum" ]] || die "$t changed or vanished since the check. Run ./publish.sh check $set again."
  done

  if [[ "$set" == mcp ]]; then
    read_fugloy_deps mcp
    for dep in "${FUGLOY_DEPS[@]}"; do
      local dver
      dver=$(pkg_field "$dep" version)
      npm view "@fugloy/$dep@$dver" version >/dev/null 2>&1 || die "@fugloy/$dep@$dver isn't on npm, and @fugloy/mcp needs it. Publish $dep first."
    done
  fi

  info "About to publish $set $version (public):"
  for e in "${entries[@]}"; do info "  ${e% *}"; done
  if [[ -z "$otp" ]]; then
    [[ -t 0 ]] || die "No --otp given and no terminal to ask on. Run: ./publish.sh publish --otp <code>"
    read -r -p "npm's 6-digit two-factor code: " otp || otp=""
  fi
  [[ "$otp" =~ ^[0-9]{6}$ ]] || die "That isn't a 6-digit code, so nothing was published."

  local names=()
  for e in "${entries[@]}"; do
    local t="${e% *}" name
    name=$(tar -xzOf "$t" package/package.json | node --input-type=commonjs -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).name)')
    names+=("$name")
    if npm view "$name@$version" version >/dev/null 2>&1; then
      info "$name@$version is already on npm; skipped."
      continue
    fi
    npm publish "$t" --access public --ignore-scripts --otp "$otp" ||
      die "Publishing $name failed (an expired code?). Packages before it are published; run ./publish.sh publish --otp <new code> to publish the rest."
    info "Published $name@$version."
  done

  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    git tag -a "$tag" -m "Fugløy $set $version"
  fi
  git push origin "$tag" || { error "Published, but pushing tag $tag failed. Push it by hand: git push origin $tag"; exit 1; }
  rm -rf "$STAGE"
  info "Done: $set $version, tagged $tag."
  for name in "${names[@]}"; do info "  https://www.npmjs.com/package/$name"; done
}

cmd_status() {
  [[ -f "$STAGE/manifest" ]] || { info "Nothing staged."; return; }
  cat "$STAGE/manifest"
}

case "${1:-}" in
  check) shift; cmd_check "$@" ;;
  publish) shift; cmd_publish "$@" ;;
  status) cmd_status ;;
  -h | --help | help | "") usage 0 ;;
  *) usage 1 ;;
esac

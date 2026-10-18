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
# @fugloy/mcp is not published until its phase F (docs/fugloy-mcp-spec.md §11).
#
# The version is whatever the packages' package.json files say: bump it, and add its CHANGELOG.md
# entry, in an ordinary commit on main first (`## [1.1.0]` for core, `## [emu 0.2.0]` for emu), as
# "p4: release 1.0.0" did. The script never edits a package.json.
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
#   - typecheck, tests, and build pass;
#   - every runtime dependency is another @fugloy package of the same release (no third-party code);
#   - each tarball holds package.json, README.md, LICENSE, and only the files its "files" field
#     names, has no workspace: specifiers left, and installs and runs from a scratch project.
# If a publish stops part way (a code expired after the first package), run `publish` again with a
# new code: packages already on npm at this version are skipped.

BRANCH="main"
STAGE=".release"
CORE_PACKAGES=(z80 disasm cli)
EMU_PACKAGES=(emu)

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
  sed -n '4,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# Read a field of a package.json with Node (CommonJS forced, the root being "type": "module").
pkg_field() {
  node --input-type=commonjs -e "const v = require('./packages/$1/package.json').$2; console.log(v === undefined ? '' : v)"
}

SCRATCH=""
cleanup() { [[ -z "$SCRATCH" ]] || rm -rf "$SCRATCH"; }
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
    mcp) die "@fugloy/mcp is published in its phase F, not before." ;;
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
  if [[ "$set" == emu ]]; then heading="emu $version"; tag="emu-v$version"; fi
  grep -qF "## [$heading]" CHANGELOG.md || die "CHANGELOG.md has no '## [$heading]' entry. Add one (move items out of [Unreleased])."
  info "CHANGELOG.md has an entry for $heading."
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null &&
    [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
    die "Tag $tag already exists on another commit."
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
  pnpm clean
  pnpm build
  [[ -z "$(git status --porcelain)" ]] || {
    git status --short
    die "The checks or the build changed the tree."
  }

  # Pack each package with pnpm, which turns workspace:* into the real version and applies
  # publishConfig, then look inside.
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  local tarballs=()
  for p in "${packages[@]}"; do
    local tgz
    tgz=$(cd "packages/$p" && pnpm pack --pack-destination "../../$STAGE" | tail -1)
    tgz="$STAGE/$(basename "$tgz")"
    [[ -f "$tgz" ]] || die "pnpm pack made no tarball for $p."
    check_tarball "$p" "$tgz" "$version"
    tarballs+=("$tgz")
  done

  # Install the tarballs together in a scratch project, as a user would, and run them.
  info "Installing the packed tarballs in a scratch project..."
  SCRATCH=$(mktemp -d)
  local abs=()
  for t in "${tarballs[@]}"; do abs+=("$PWD/$t"); done
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

  # Record what was checked, for `publish` to verify.
  {
    echo "set=$set"
    echo "version=$version"
    echo "tag=$tag"
    echo "commit=$(git rev-parse HEAD)"
    for t in "${tarballs[@]}"; do echo "tarball=$t $(shasum -a 256 "$t" | cut -d' ' -f1)"; done
  } >"$STAGE/manifest"

  local last
  last=$(git describe --tags --abbrev=0 --match "$([[ $set == emu ]] && echo 'emu-v*' || echo 'v*')" 2>/dev/null || true)
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
  local p="$1" tgz="$2" version="$3"
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
  # Dependencies: only @fugloy packages, at exactly this release's version.
  local bad
  bad=$(tar -xzOf "$tgz" package/package.json | node --input-type=commonjs -e '
    const pkg = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const out = [];
    if (pkg.version !== process.argv[1]) out.push("version is " + pkg.version);
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
      if (!name.startsWith("@fugloy/")) out.push("third-party dependency " + name);
      else if (spec !== process.argv[1]) out.push(name + " is " + spec + ", not " + process.argv[1]);
    }
    if (JSON.stringify(pkg).includes("workspace:")) out.push("a workspace: specifier is left");
    console.log(out.join("\n"));
  ' "$version")
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
    else
      node --input-type=module -e 'import { Machine, COVERAGE } from "@fugloy/emu"; if (typeof Machine !== "function" || COVERAGE.EXEC !== 1) process.exit(1);'
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

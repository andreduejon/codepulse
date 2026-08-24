# Releasing Codepulse

Releases are created from tags on `main`. Do not create or publish the GitHub
Release manually in the GitHub UI: the Release workflow creates it only after
every binary passes validation.

## Prepare

1. Update `package.json`, `bun.lock`, and `CHANGELOG.md` to the same version.
2. Merge the release changes through `develop` and then `main`.
3. Confirm CI passes on the exact `main` commit:

```sh
git switch main
git pull --ff-only origin main
gh run list --branch main --workflow CI --limit 1
```

## Tag

Create and push an annotated version tag matching `package.json`:

```sh
version="$(bun -p "require('./package.json').version")"
git tag -a "v$version" -m "Release v$version"
git push origin "v$version"
```

## Monitor

```sh
run_id="$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

The workflow verifies the source, builds four platform executables, signs the
macOS binaries, tests the OpenTUI native/worker/WASM assets, creates checksums,
and publishes the GitHub Release only after all matrix jobs succeed.

## Verify

Verify the published assets and test installation in a temporary directory:

```sh
gh release view "v$version"
test_root="$(mktemp -d)"
install_dir="$test_root/bin"
curl -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.sh |
  CODEPULSE_INSTALL_DIR="$install_dir" sh
"$install_dir/codepulse" --version
rm -rf "$test_root"
```

#!/bin/sh

set -eu

repository="andreduejon/codepulse"
version="${CODEPULSE_VERSION:-latest}"
install_dir="${CODEPULSE_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *)
    printf 'codepulse: unsupported operating system: %s\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    printf 'codepulse: unsupported architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

target="$platform-$arch"
if [ "$platform" = "linux" ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
  printf 'codepulse: this Linux distribution uses musl, which is not currently supported\n' >&2
  exit 1
fi

archive="codepulse-$target.tar.gz"
if [ "$version" = "latest" ]; then
  release_url="https://github.com/$repository/releases/latest/download"
else
  case "$version" in
    v*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
  release_url="https://github.com/$repository/releases/download/$tag"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

curl -fsSL "$release_url/$archive" -o "$tmp_dir/$archive"
curl -fsSL "$release_url/SHA256SUMS" -o "$tmp_dir/SHA256SUMS"

expected=""
while read -r checksum file; do
  if [ "$file" = "$archive" ]; then
    expected="$checksum"
    break
  fi
done < "$tmp_dir/SHA256SUMS"

if [ -z "$expected" ]; then
  printf 'codepulse: %s is missing from SHA256SUMS\n' "$archive" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp_dir/$archive")"
else
  actual="$(shasum -a 256 "$tmp_dir/$archive")"
fi
actual="${actual%% *}"

if [ "$actual" != "$expected" ]; then
  printf 'codepulse: checksum verification failed for %s\n' "$archive" >&2
  exit 1
fi

tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
mkdir -p "$install_dir"
cp "$tmp_dir/codepulse" "$install_dir/codepulse"
chmod 755 "$install_dir/codepulse"

printf 'Installed codepulse to %s/codepulse\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to run codepulse from any terminal.\n' "$install_dir" ;;
esac

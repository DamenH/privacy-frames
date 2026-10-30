#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
jar="$root/.tools/tla2tools.jar"
[ -f "$jar" ] || { echo 'Missing .tools/tla2tools.jar (TLA+ v1.8.0)' >&2; exit 1; }
printf '%s  %s\n' fc6878c603f0fdc18b9fe3e5bf51860cb90ab5b1154e3c371660c036d6bdd63e "$jar" | sha256sum -c - >/dev/null
image='eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
run() {
  docker run --rm --network none -v "$root:/work:ro" -w /tmp "$image" \
    java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 -metadir /tmp/tlcstates -noGenerateSpecTE -config "/work/formal/confinement/$1.cfg" /work/formal/confinement/Confinement.tla > "$out/$1.log" 2>&1
}
run Safe || { cat "$out/Safe.log"; exit 1; }
grep -q 'Model checking completed. No error has been found' "$out/Safe.log"
for pair in EarlyPublish:PreparedBeforePublication Authority:NoTrustedAuthority Fallback:NoNetworkDisclosure Effect:NoNetworkDisclosure; do
  name=${pair%%:*}; invariant=${pair#*:}
  if run "$name"; then echo "Expected counterexample missing: $name" >&2; exit 1; fi
  grep -q "Invariant $invariant is violated" "$out/$name.log" || { cat "$out/$name.log"; exit 1; }
  echo "$name: $invariant counterexample found"
done
printf 'Safe: all four invariants passed for two contexts\n'

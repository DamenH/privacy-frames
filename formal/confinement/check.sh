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

run_lifecycle() {
  docker run --rm --network none -v "$root:/work:ro" -w /tmp "$image" \
    java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 -metadir /tmp/tlcstates -noGenerateSpecTE \
    -config "/work/formal/confinement/Lifecycle$1.cfg" /work/formal/confinement/Lifecycle.tla > "$out/Lifecycle$1.log" 2>&1
}
run_lifecycle Safe || { cat "$out/LifecycleSafe.log"; exit 1; }
grep -q 'Model checking completed. No error has been found' "$out/LifecycleSafe.log"
for pair in EarlyPublish:PublishedIsPrepared ExposeAuthority:NoForgedAuthority NetworkFallback:NoRemoteTraffic UnmediatedEffect:NoRemoteTraffic AcceptStale:NoStaleAcceptance ForgedManagement:NoForgedAuthority ReachNoRunningChild:NoRunningChild ReachNoReplacement:NoReplacement ReachNoChildBeforeParentRun:NoChildBeforeParentRun; do
  name=${pair%%:*}; invariant=${pair#*:}
  if run_lifecycle "$name"; then echo "Expected lifecycle counterexample missing: $name" >&2; exit 1; fi
  grep -q "Invariant $invariant is violated" "$out/Lifecycle$name.log" || { cat "$out/Lifecycle$name.log"; exit 1; }
  echo "Lifecycle $name: $invariant counterexample found"
done
printf 'Lifecycle Safe: six invariants passed for two contexts and one replacement\n'
run_admission() {
  docker run --rm --network none -v "$root:/work:ro" -w /tmp "$image" \
    java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 -metadir /tmp/tlcstates -noGenerateSpecTE \
    -config "/work/formal/confinement/Admission$1.cfg" /work/formal/confinement/Admission.tla > "$out/Admission$1.log" 2>&1
}
run_admission Safe || { cat "$out/AdmissionSafe.log"; exit 1; }
grep -q 'Model checking completed. No error has been found' "$out/AdmissionSafe.log"
for pair in ForgedInstall:NoUnauthorizedCommit TamperAdmission:NoUnverifiedAdmission NetworkFallback:NoRemoteTraffic ExecuteDuringInstall:NoApplicationDuringInstall ReachStored:NoStoredPrivate; do
  name=${pair%%:*}; invariant=${pair#*:}
  if run_admission "$name"; then echo "Expected admission counterexample missing: $name" >&2; exit 1; fi
  grep -q "Invariant $invariant is violated" "$out/Admission$name.log" || { cat "$out/Admission$name.log"; exit 1; }
  echo "Admission $name: $invariant counterexample found"
done
printf 'Admission Safe: four invariants passed for two resources\n'
run_registry() {
  docker run --rm --network none -v "$root:/work:ro" -w /tmp "$image" \
    java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 -metadir /tmp/tlcstates -noGenerateSpecTE \
    -config "/work/formal/confinement/Registry$1.cfg" /work/formal/confinement/Registry.tla > "$out/Registry$1.log" 2>&1
}
run_registry Safe || { cat "$out/RegistrySafe.log"; exit 1; }
grep -q 'Model checking completed. No error has been found' "$out/RegistrySafe.log"
for pair in IgnoreClosure:NoBoundAfterCloseRequest ReviveClosed:NoRevival WrongOwner:NoWrongOwnerClose; do
  name=${pair%%:*}; invariant=${pair#*:}
  if run_registry "$name"; then echo "Expected registry counterexample missing: $name" >&2; exit 1; fi
  grep -q "Invariant $invariant is violated" "$out/Registry$name.log" || { cat "$out/Registry$name.log"; exit 1; }
  echo "Registry $name: $invariant counterexample found"
done
printf 'Registry Safe: three invariants passed for one context and two owners\n'

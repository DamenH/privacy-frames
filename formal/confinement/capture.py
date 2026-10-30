#!/usr/bin/env python3
"""Capture TLC output for review; these are abstract-model traces, not browser traces."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
directory = root / 'formal/confinement'
image = 'eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
expected = {
    'LifecycleSafe': None,
    'LifecycleEarlyPublish': 'PublishedIsPrepared',
    'LifecycleExposeAuthority': 'NoForgedAuthority',
    'LifecycleNetworkFallback': 'NoRemoteTraffic',
    'LifecycleUnmediatedEffect': 'NoRemoteTraffic',
    'LifecycleAcceptStale': 'NoStaleAcceptance',
    'LifecycleForgedManagement': 'NoForgedAuthority',
    'LifecycleReachNoRunningChild': 'NoRunningChild',
    'LifecycleReachNoReplacement': 'NoReplacement',
    'LifecycleReachNoChildBeforeParentRun': 'NoChildBeforeParentRun',
    'AdmissionSafe': None,
    'AdmissionForgedInstall': 'NoUnauthorizedCommit',
    'AdmissionTamperAdmission': 'NoUnverifiedAdmission',
    'AdmissionNetworkFallback': 'NoRemoteTraffic',
    'AdmissionExecuteDuringInstall': 'NoApplicationDuringInstall',
    'AdmissionReachStored': 'NoStoredPrivate',
    'RegistrySafe': None,
    'RegistryIgnoreClosure': 'NoBoundAfterCloseRequest',
    'RegistryReviveClosed': 'NoRevival',
    'RegistryWrongOwner': 'NoWrongOwnerClose',
}
jar = root / '.tools/tla2tools.jar'
assert hashlib.sha256(jar.read_bytes()).hexdigest() == 'fc6878c603f0fdc18b9fe3e5bf51860cb90ab5b1154e3c371660c036d6bdd63e'
results = []
for config, invariant in expected.items():
    module = next(name for name in ('Lifecycle', 'Admission', 'Registry') if config.startswith(name))
    cmd = ['docker', 'run', '--rm', '--network', 'none', '-v', f'{root}:/work:ro',
           '-w', '/tmp', image, 'java', '-cp', '/work/.tools/tla2tools.jar', 'tlc2.TLC',
           '-workers', '1', '-metadir', '/tmp/tlcstates', '-noGenerateSpecTE', '-config',
           f'/work/formal/confinement/{config}.cfg', f'/work/formal/confinement/{module}.tla']
    run = subprocess.run(cmd, capture_output=True, text=True)
    output = run.stdout + run.stderr
    if invariant is None:
        assert run.returncode == 0 and 'Model checking completed. No error has been found' in output, config
    else:
        assert run.returncode != 0 and f'Invariant {invariant} is violated' in output, config
    results.append({'configuration': config, 'expectedViolation': invariant,
                    'exitCode': run.returncode, 'output': output})
receipt = {'scope': 'Bounded abstract model checks. Fault switches and reachability controls are not browser or implementation tests.',
           'image': image, 'jarSHA256': hashlib.sha256(jar.read_bytes()).hexdigest(),
           'inputs': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in sorted(directory.glob('*')) if p.suffix in {'.tla', '.cfg'}},
           'results': results}
(directory / 'traces.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(f'{len(results)} checked TLC configurations recorded')

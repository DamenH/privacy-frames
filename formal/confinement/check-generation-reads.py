#!/usr/bin/env python3
"""Check bounded resource-generation models with the existing pinned TLC runtime."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
directory = root / 'formal/confinement'
jar = root / '.tools/tla2tools.jar'
expected_jar = 'fc6878c603f0fdc18b9fe3e5bf51860cb90ab5b1154e3c371660c036d6bdd63e'
image = 'eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
expected = {
    'Safe': None,
    'SplitRead': 'ConsistentSnapshot',
    'SplitWrite': 'ConsistentSnapshot',
    'IgnoreGeneration': 'MatchesCallerGeneration',
    'CurrentDelivery': 'DeliveryUsesCheckedBytes',
    'ReachLateDelivery': 'NoLateDelivery',
    'ReachRejectedRead': 'NoRejectedRead',
    'ReachNewDelivery': 'NoNewDelivery',
}
if not jar.is_file():
    raise SystemExit('Missing .tools/tla2tools.jar; see generation-reads.md')
if hashlib.sha256(jar.read_bytes()).hexdigest() != expected_jar:
    raise SystemExit('Unexpected TLA+ jar hash')
results = []
for suffix, violation in expected.items():
    config = 'GenerationRead' + suffix
    command = [
        'docker', 'run', '--rm', '--network', 'none', '-v', f'{root}:/work:ro',
        '-w', '/tmp', image, 'java', '-cp', '/work/.tools/tla2tools.jar', 'tlc2.TLC',
        '-workers', '1', '-metadir', '/tmp/tlcstates', '-noGenerateSpecTE',
        '-config', f'/work/formal/confinement/{config}.cfg',
        '/work/formal/confinement/GenerationRead.tla',
    ]
    run = subprocess.run(command, capture_output=True, text=True)
    output = run.stdout + run.stderr
    if violation is None:
        passed = run.returncode == 0 and 'Model checking completed. No error has been found' in output
    else:
        passed = run.returncode != 0 and f'Invariant {violation} is violated' in output
    if not passed:
        print(output)
        raise SystemExit(f'Unexpected TLC outcome: {config}')
    count = re.search(r'(\d+) states generated, (\d+) distinct states found', output)
    results.append({
        'configuration': config,
        'expectedViolation': violation,
        'exitCode': run.returncode,
        'statesGenerated': int(count.group(1)) if count else None,
        'distinctStates': int(count.group(2)) if count else None,
        'output': output,
    })
    print(config + ': ' + ('safe invariants passed' if violation is None else violation + ' counterexample found'))
inputs = [directory / 'GenerationRead.tla'] + sorted(directory.glob('GenerationRead*.cfg'))
receipt = {
    'scope': 'Bounded abstract transaction/read-delivery model; not execution traces or a browser IndexedDB correctness proof.',
    'bounds': {'applications': 1, 'resourcePaths': 1, 'generations': 2, 'readSlots': 2,
               'replacements': 1, 'readStartsPerSlot': 1, 'replacementMayRemovePath': True},
    'image': image,
    'jarSHA256': expected_jar,
    'storageSourceSHA256': hashlib.sha256((root / 'src/runtime/storage.ts').read_bytes()).hexdigest(),
    'inputs': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs},
    'results': results,
}
(directory / 'generation-read-traces.json').write_text(json.dumps(receipt, indent=2) + '\n')

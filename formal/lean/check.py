#!/usr/bin/env python3
"""Run the pinned Lean kernel and reject unreviewed theorem dependencies."""
import os
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
lean = os.environ.get('PF_LEAN', str(root / '.tools/lean-4.35.0-linux/bin/lean'))
version = subprocess.check_output([lean, '--version'], text=True)
if 'Lean (version 4.35.0,' not in version:
    raise SystemExit(f'Expected Lean 4.35.0, got {version.strip()}')

checks = {
    'CapabilityBoundary.lean': [
        'PrivacyFrames.no_remote_effect',
        'PrivacyFrames.unsafe_grant_has_counterexample',
    ],
    'Reachability.lean': [
        'PrivacyFrames.Graph.reachable_cannot_use_network',
        'PrivacyFrames.Graph.no_network_along_history',
        'PrivacyFrames.Graph.broken_multistep_reaches_network',
        'PrivacyFrames.Graph.broken_multistep_violates_closure',
    ],
}
for name, theorems in checks.items():
    path = root / 'formal/lean' / name
    run = subprocess.run([lean, '--trust=0', str(path)], capture_output=True, text=True)
    if run.returncode:
        raise SystemExit(run.stdout + run.stderr)
    expected = {f"'{theorem}' does not depend on any axioms" for theorem in theorems}
    if set(run.stdout.splitlines()) != expected or run.stderr:
        raise SystemExit(f'Unexpected proof output for {name}:\n{run.stdout}{run.stderr}')
    print(f'{name}: {len(theorems)} kernel-checked theorems; no axioms')

# A test-only mutation removes the edge-admission premise. The preservation
# proof must no longer type-check; never change the checked-in proof to do this.
source = (root / 'formal/lean/Reachability.lean').read_text()
needle = '(current.allowed source → current.allowed target) →'
if source.count(needle) != 1:
    raise SystemExit('Edge-admission mutation anchor changed')
with tempfile.TemporaryDirectory(prefix='pf-lean-fault-') as directory:
    broken = Path(directory) / 'Broken.lean'
    broken.write_text(source.replace(needle, 'True →'))
    result = subprocess.run([lean, '--trust=0', str(broken)], capture_output=True, text=True)
    output = result.stdout + result.stderr
    if result.returncode == 0 or 'Application type mismatch' not in output or 'add_preserves_valid' not in output:
        raise SystemExit('Expected edge-admission mutation to fail kernel checking')
print('Fault control: removing the edge-admission condition invalidates the proof')

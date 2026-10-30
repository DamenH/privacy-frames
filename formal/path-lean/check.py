#!/usr/bin/env python3
"""Kernel-check the path-loop theorem and a faulty test-only variant."""
import os
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
lean = os.environ.get('PF_LEAN', str(root / '.tools/lean-4.35.0-linux/bin/lean'))
version = subprocess.check_output([lean, '--version'], text=True)
if 'Lean (version 4.35.0,' not in version:
    raise SystemExit(f'Expected Lean 4.35.0, got {version.strip()}')
path = root / 'formal/path-lean/CanonicalAdmission.lean'
source = path.read_text()
result = subprocess.run([lean, '--trust=0', str(path)], text=True, capture_output=True)
expected = "'CanonicalAdmission.checked_properties' depends on axioms: [propext, Quot.sound]"
if result.returncode or result.stdout.strip() != expected or result.stderr:
    raise SystemExit(f'Unexpected proof output:\n{result.stdout}{result.stderr}')
needle = 'allowed target && !(seen.contains target)'
if source.count(needle) != 1:
    raise SystemExit('Mutation anchor changed')
with tempfile.TemporaryDirectory(prefix='pf-path-proof-') as directory:
    for name, replacement, guard_type in [
        ('NoCollisionCheck', 'allowed target', 'allowed target = true'),
        ('NoScopeCheck', '!(seen.contains target)', '(!seen.contains target) = true'),
    ]:
        altered = Path(directory) / f'{name}.lean'
        altered.write_text(source.replace(needle, replacement))
        faulty = subprocess.run([lean, '--trust=0', str(altered)], text=True, capture_output=True)
        output = faulty.stdout + faulty.stderr
        if (faulty.returncode == 0
            or 'error: Application type mismatch' not in output
            or f'guard\nhas type\n  {guard_type}' not in output
            or 'Bool.and_eq_true_iff.mp guard' not in output
            or "'CanonicalAdmission.checked_properties' depends on axioms: [propext, sorryAx, Quot.sound]" not in output):
            raise SystemExit(f'{name} did not fail at the expected proof step:\n{output}')
print('CanonicalAdmission: theorem checked (propext and Quot.sound); removing either check breaks proof')

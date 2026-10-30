#!/usr/bin/env python3
"""Compare two native-interface inventories; changed names require human review."""
import json
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 formal/browser-feature-diff.py BASELINE CURRENT')

def names(browser):
    surface = browser['surfaces']
    result = set()
    for kind in ('window', 'navigator', 'document'):
        for level in surface[kind]:
            result.update(f'{kind}.{name}' for name in level)
    for constructor, members in surface['windowConstructors'].items():
        result.update(f'window:{constructor}.prototype.{member}' for member in members)
    for level in surface['worker']['chain']:
        result.update(f'worker.{name}' for name in level)
    for constructor, members in surface['worker']['constructors'].items():
        result.update(f'worker:{constructor}.prototype.{member}' for member in members)
    return result

before = {item['name']: item for item in json.loads(Path(sys.argv[1]).read_text())['browsers']}
after = {item['name']: item for item in json.loads(Path(sys.argv[2]).read_text())['browsers']}
if before.keys() != after.keys():
    raise SystemExit('Browser sets differ; review missing browsers explicitly')
report = {}
for browser in sorted(before):
    old, new = names(before[browser]), names(after[browser])
    report[browser] = {'baselineVersion': before[browser]['version'],
                       'currentVersion': after[browser]['version'],
                       'added': sorted(new - old), 'removed': sorted(old - new)}
print(json.dumps(report, indent=2))

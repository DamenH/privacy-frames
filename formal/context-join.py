#!/usr/bin/env python3
"""Join a saved native worker-context snapshot to the bounded IDL rows."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE / 'evidence/context-features.json'
IDL = HERE / 'evidence/idl-surface-report.json'
OUTPUT = HERE / 'evidence/context-idl-join.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def observations(surface, interface, member, static, context):
    if interface == 'ServiceWorkerGlobalScope':
        if context != 'service':
            return 'not-applicable'
        names = {name for layer in surface['global'] for name in layer}
    elif interface in ('WorkerGlobalScope', 'WindowOrWorkerGlobalScope'):
        names = {name for layer in surface['global'] for name in layer}
    elif interface == 'WorkerNavigator' and not static:
        names = {name for layer in surface['navigator'] for name in layer}
    elif interface in ('Window', 'Navigator', 'Document'):
        return 'not-applicable'
    else:
        table = surface['statics'] if static else surface['prototypes']
        if interface not in table:
            return 'no-constructor-observation'
        names = set(table[interface])
    return 'observed' if member in names else 'not-observed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    raw_snapshot = SNAPSHOT.read_bytes()
    raw_idl = IDL.read_bytes()
    snapshot, idl = json.loads(raw_snapshot), json.loads(raw_idl)
    rows = []
    for row in idl['rows']:
        member = 'prototype' if row['kind'] == 'constructor' else row['member']
        result = {}
        for browser in snapshot['browsers']:
            result[browser['name']] = {
                context: observations(browser['surfaces'][context], row['interface'],
                                      member, row['static'], context)
                for context in ('dedicated', 'shared', 'service')
            }
        rows.append({'spec': row['spec'], 'interface': row['interface'],
                     'member': row['member'], 'kind': row['kind'],
                     'observations': result})
    joined = {
        'scope': 'Names only, in unrestricted loopback contexts. A matching name does not prove a member is reachable, callable, a network effect, or permitted in a confined context. IDL exposure, inherited mixins, browser state and other contexts require separate review.',
        'snapshotSHA256': digest(raw_snapshot),
        'idlReportSHA256': digest(raw_idl),
        'generatorSHA256': digest(Path(__file__).read_bytes()),
        'browsers': [{key: browser[key] for key in ('name', 'version')} for browser in snapshot['browsers']],
        'rows': rows,
    }
    encoded = (json.dumps(joined, indent=2) + '\n').encode()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != encoded:
            raise SystemExit('context join differs; review inputs and regenerate')
    else:
        OUTPUT.write_bytes(encoded)
    counts = {context: sum(1 for row in rows if any(
        browser[context] == 'observed' for browser in row['observations'].values()))
        for context in ('dedicated', 'shared', 'service')}
    print(json.dumps({'rows': len(rows), 'observedAtLeastOneBrowser': counts}))


if __name__ == '__main__':
    main()

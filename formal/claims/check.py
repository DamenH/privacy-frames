#!/usr/bin/env python3
"""Validate ledger structure and detect changes to its referenced artifacts."""

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KINDS = {
    'native_control',
    'confined_test',
    'fault_control',
    'formal_theorem',
    'deductive_verification',
    'historical_control',
    'model_fault',
    'trace_comparison',
    'discovery',
}


def main():
    if not __debug__:
        raise RuntimeError('Run this checker without Python optimization')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, default=ROOT / 'formal/claims/ledger.json')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    ledger = json.loads(args.ledger.read_text())
    assert ledger['schema_version'] == 1, 'Unsupported ledger schema'
    assert re.fullmatch(r'[0-9a-f]{40}', ledger['source_baseline']), 'Invalid baseline'
    assert isinstance(ledger['scope'], str) and ledger['scope'], 'Missing scope'
    artifacts = ledger['artifact_sha256']
    assert isinstance(artifacts, dict) and artifacts, 'Missing artifact hashes'
    referenced = set()
    ids = set()
    for claim in ledger['claims']:
        identifier = claim['id']
        assert re.fullmatch(r'[a-z][a-z0-9_]*', identifier), 'Invalid claim ID'
        assert identifier not in ids, f'Duplicate claim: {identifier}'
        ids.add(identifier)
        assert claim['disposition'] in {'reviewed-scoped', 'unverified'}, (
            f'Unknown disposition: {identifier}'
        )
        for field in ('title', 'preconditions', 'enforcement'):
            assert isinstance(claim[field], str) and claim[field], f'{identifier}: {field}'
        assert claim['source_paths'], f'{identifier}: missing source'
        assert claim['evidence'], f'{identifier}: missing evidence'
        assert claim['open_obligations'] and all(
            isinstance(item, str) and item for item in claim['open_obligations']
        ), f'{identifier}: missing open obligations'
        referenced.update(claim['source_paths'])
        recorded_kinds = set()
        for item in claim['evidence']:
            assert item['kind'] in KINDS, f'{identifier}: unknown evidence kind'
            recorded_kinds.add(item['kind'])
            assert isinstance(item['description'], str) and item['description']
            assert item['paths'], f'{identifier}: missing evidence path'
            referenced.update(item['paths'])
        control_names = {'native_control', 'confined_test', 'fault_control'}
        assert set(claim['control_status']) == control_names, (
            f'{identifier}: incomplete control status'
        )
        for control in control_names:
            expected_status = 'recorded' if control in recorded_kinds else 'not-recorded'
            assert claim['control_status'][control] == expected_status, (
                f'{identifier}: inconsistent {control} status'
            )
    assert ids, 'No claims'
    assert referenced == set(artifacts), 'Artifact hashes and referenced paths differ'
    for relative, expected in artifacts.items():
        path = (root / relative).resolve()
        assert path.is_relative_to(root), f'Path escapes root: {relative}'
        assert path.is_file(), f'Missing artifact: {relative}'
        assert re.fullmatch(r'[0-9a-f]{64}', expected), f'Invalid digest: {relative}'
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        assert actual == expected, f'Artifact changed; review required: {relative}'
    print(f'{len(ids)} claims and {len(artifacts)} referenced artifacts checked')


if __name__ == '__main__':
    main()

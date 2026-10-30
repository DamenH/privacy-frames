#!/usr/bin/env python3
"""Produce a review queue from the saved bounded IDL join, without inferring safety."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
INPUT = ROOT / 'formal/evidence/idl-surface-report.json'
TRIAGE = HERE / 'triage.json'
OUTPUT = HERE / 'queue.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='fail if the saved queue differs')
    parser.add_argument('--verify-wpt', action='store_true', help='download selected pinned WPT files and check their SHA-256')
    args = parser.parse_args()
    raw, annotations = INPUT.read_bytes(), TRIAGE.read_bytes()
    report, triage = json.loads(raw), json.loads(annotations)
    wpt = triage['wpt']
    if args.verify_wpt:
        for item in wpt.values():
            url = f"https://raw.githubusercontent.com/web-platform-tests/wpt/{triage['wptRevision']}/{item['path']}"
            with urllib.request.urlopen(url, timeout=30) as response:
                digest = sha(response.read())
            if digest != item['sha256']:
                raise ValueError(f"WPT digest mismatch for {item['path']}")
    reviews = {item['key']: item for item in triage['reviews']}
    if len(reviews) != len(triage['reviews']):
        raise ValueError('duplicate manual review key')
    counts = collections.Counter()
    matched = set()
    rows = []
    for row in report['rows']:
        key = '|'.join([row['spec'], row['interface'], row['member'], row['kind']])
        counts[key] += 1
        review = reviews.get(key)
        if review:
            matched.add(key)
            if any(ref not in wpt for ref in review['wpt']):
                raise ValueError(f'unknown WPT reference in {key}')
        rows.append({
            'id': f'{key}|{counts[key]}',
            'specificationURL': row['specificationURL'],
            'static': row['static'],
            'partial': row['partial'],
            'observations': row['observations'],
            'priorReviewPointer': row['review'],
            'classification': review['class'] if review else 'unreviewed',
            'selectedWpt': review['wpt'] if review else [],
            'next': review['next'] if review else 'Review the standard algorithm, reachable contexts and potential effects.',
        })
    if set(reviews) != matched:
        raise ValueError(f"manual review keys not present: {sorted(set(reviews) - matched)}")
    output = {
        'scope': 'All rows in the bounded saved IDL join; unreviewed includes absent and unobserved names. Classifications and WPT links are manually selected review leads, not mediation tests or safety judgments.',
        'idlReportSHA256': sha(raw),
        'triageSHA256': sha(annotations),
        'generatorSHA256': sha(Path(__file__).read_bytes()),
        'webrefRevision': report['webrefRevision'],
        'snapshotRevision': report['snapshotRevision'],
        'browsers': report['browsers'],
        'wptRevision': triage['wptRevision'],
        'wpt': wpt,
        'summary': {'rows': len(rows), 'manualRows': sum(row['classification'] != 'unreviewed' for row in rows), 'unreviewedRows': sum(row['classification'] == 'unreviewed' for row in rows), 'observedUnreviewedRows': sum(row['classification'] == 'unreviewed' and any(state == 'observed' for values in row['observations'].values() for state in values.values()) for row in rows)},
        'rows': rows,
    }
    encoded = (json.dumps(output, indent=2) + '\n').encode()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != encoded:
            raise SystemExit('queue differs; review input changes, then regenerate')
    else:
        OUTPUT.write_bytes(encoded)
    print(json.dumps(output['summary']))


if __name__ == '__main__':
    main()

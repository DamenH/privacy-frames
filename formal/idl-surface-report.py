"""Join a bounded pinned Webref IDL set to the saved native feature snapshot.

No security classification follows from a property name or an IDL declaration.
Run from any directory with Python 3 and network access; no browser launch needed.
"""

import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
WEBREF = '6ac6259c96b11e0aea5c34a16822eb06add278c9'
SPECS = [
    'beacon', 'fetch', 'websockets', 'webtransport', 'service-workers',
    'background-fetch', 'background-sync', 'periodic-background-sync',
    'credential-management-1', 'fedcm-1', 'reporting-1',
]
# Exact reviewed entry points, with the scope of their existing evidence.
# Deliberately not a classifier inferred from substrings or source-code matches.
REVIEW = {
    'Navigator.sendBeacon': ['aggregate-network-tests-only', 'test/run.ts'],
    'WindowOrWorkerGlobalScope.fetch': ['source-and-receiver-tests', 'test/network.ts'],
    'Window.fetchLater': ['deferred-close-receiver-control', 'formal/fetch-later.md'],
    'WebSocket.constructor': ['source-and-receiver-tests', 'test/prototype-confinement.ts'],
    'WebTransport.constructor': ['independent-receiver', 'formal/webtransport/README.md'],
    'ServiceWorkerContainer.register': ['virtualized-registration', 'test/publisher-contexts.ts'],
    'ServiceWorkerRegistration.update': ['denial-and-lifecycle-tests', 'test/website-installation.ts'],
    'ServiceWorkerRegistration.unregister': ['virtualized-registration', 'test/website-installation.ts'],
    'ServiceWorkerRegistration.backgroundFetch': ['seeded-native-acquisition-control', 'formal/background-agents.md'],
    'BackgroundFetchManager.fetch': ['seeded-native-acquisition-control', 'formal/background-agents.md'],
    'ServiceWorkerRegistration.sync': ['seeded-native-acquisition-control', 'formal/background-agents.md'],
    'SyncManager.register': ['seeded-native-acquisition-control', 'formal/background-agents.md'],
    'ServiceWorkerRegistration.periodicSync': ['permission-control-unavailable', 'formal/background-agents.md'],
    'PeriodicSyncManager.register': ['permission-control-unavailable', 'formal/background-agents.md'],
    'CredentialsContainer.create': ['source-denial-unverified-receiver', 'src/runtime/enforcement/effects.ts'],
    'CredentialsContainer.store': ['source-denial-unverified-receiver', 'src/runtime/enforcement/effects.ts'],
    'CredentialsContainer.preventSilentAccess': ['source-denial-unverified-receiver', 'src/runtime/enforcement/effects.ts'],
    'CredentialsContainer.get': ['conditional-fedcm-control', 'formal/fedcm-conditional-probe.ts'],
    'IdentityCredential.disconnect': ['conditional-receiver-escape-fixed', 'formal/fedcm-conditional-probe.ts'],
    'IdentityProvider.getUserInfo': ['source-denial-unverified-receiver', 'src/runtime/enforcement/effects.ts'],
    'ReportingObserver.constructor': ['observer-is-not-upload-entry-point', 'formal/modern-reporting-probe.ts'],
}


def download(spec):
    url = f'https://raw.githubusercontent.com/w3c/webref/{WEBREF}/ed/idlparsed/{spec}.json'
    with urllib.request.urlopen(url, timeout=30) as response:
        body = response.read()
    return spec, json.loads(body), {'url': url, 'sha256': hashlib.sha256(body).hexdigest()}


def flatten(chains):
    return set(name for chain in chains for name in chain)


def observe(surfaces, interface, member, static, context):
    """Return only property-name observations; never infer getter reachability."""
    worker = context == 'dedicated-worker'
    if interface in ['Window', 'WindowOrWorkerGlobalScope']:
        if worker and interface == 'Window':
            return 'context-not-applicable'
        names = flatten(surfaces['worker']['chain'] if worker else surfaces['window'])
        return 'observed' if member in names else 'not-observed'
    if interface in ['Navigator', 'Document'] and not worker and not static:
        names = flatten(surfaces[interface.lower()])
        return 'observed' if member in names else 'not-observed'
    if interface in ['Navigator', 'Document', 'ServiceWorkerGlobalScope', 'WorkerNavigator'] and worker:
        return 'snapshot-does-not-capture-this-object'
    if static:
        table = surfaces['worker']['constructorStatics'] if worker else surfaces['windowConstructorStatics']
    else:
        table = surfaces['worker']['constructors'] if worker else surfaces['windowConstructors']
    if interface not in table:
        return 'no-constructor-prototype-observation'
    return 'observed' if member in table[interface] else 'not-observed'


for annotation in REVIEW.values():
    assert (ROOT.parent / annotation[1]).is_file(), annotation[1]

snapshot_bytes = (ROOT / 'browser-features.json').read_bytes()
snapshot = json.loads(snapshot_bytes)
rows = []
inputs = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    documents = list(pool.map(download, SPECS))
for spec, document, source in documents:
    inputs[spec] = source
    parsed = document['idlparsed']
    definitions = list(parsed['idlNames'].values())
    definitions.extend(item for group in parsed['idlExtendedNames'].values() for item in group)
    for interface in definitions:
        if interface['type'] not in ['interface', 'interface mixin', 'namespace']:
            continue
        for member in interface.get('members', []):
            if member['type'] not in ['operation', 'attribute', 'constructor']:
                continue
            name = 'constructor' if member['type'] == 'constructor' else member.get('name')
            if not name:
                continue
            static = member.get('special') == 'static' or member['type'] == 'constructor'
            key = interface['name'] + '.' + name
            observations = {}
            for browser in snapshot['browsers']:
                observations[browser['name']] = {
                    context: observe(browser['surfaces'], interface['name'],
                                     'prototype' if name == 'constructor' else name,
                                     static, context)
                    for context in ['window', 'dedicated-worker']
                }
            annotation = REVIEW.get(key)
            rows.append({
                'spec': spec, 'interface': interface['name'], 'member': name,
                'kind': member['type'], 'static': static,
                'partial': interface.get('partial', False),
                'specificationURL': member.get('href', interface.get('href')),
                'observations': observations,
                'review': {'status': annotation[0], 'path': annotation[1]} if annotation else None,
            })
rows.sort(key=lambda row: (row['spec'], row['interface'], row['member'], row['kind']))
candidates = [row for row in rows if row['review'] is None and any(
    state == 'observed' for contexts in row['observations'].values() for state in contexts.values()
)]
report = {
    'scope': 'Bounded member-name join, not an effect detector, reachability proof, runtime-policy test or complete WebIDL inventory. Unannotated means absent from this curated ledger, not absent from all project tests. No automatic WPT pass or containment inference.',
    'webrefRevision': WEBREF,
    'snapshotRevision': snapshot['revision'],
    'snapshotSHA256': hashlib.sha256(snapshot_bytes).hexdigest(),
    'generatorSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'browsers': [{key: browser[key] for key in ['name', 'version']} for browser in snapshot['browsers']],
    'inputs': inputs,
    'summary': {'specifications': len(SPECS), 'memberRows': len(rows),
                'observedUnannotatedRows': len(candidates)},
    'observedUnannotatedCandidates': [row['interface'] + '.' + row['member'] for row in candidates],
    'rows': rows,
}
(ROOT / 'evidence/idl-surface-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['summary']))

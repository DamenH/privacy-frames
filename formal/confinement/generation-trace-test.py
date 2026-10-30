#!/usr/bin/env python3
"""Compare observed IndexedDB outcomes with possible safe TLC completions.

This is a partial observation check, not instrumentation of transaction commits.
The browser fixture has already asserted byte equality before labeling a read.
"""
import hashlib
import json
import subprocess
from collections import deque
from pathlib import Path

root = Path(__file__).resolve().parents[2]
directory = root / 'formal/confinement'
subprocess.run(['python3', str(directory / 'generate-generation-graph.py')], check=True)
graph_path = directory / 'generation-read-graph.json'
evidence_path = root / 'formal/evidence/generation-overlaps.json'
graph = json.loads(graph_path.read_text())
evidence = json.loads(evidence_path.read_text())
nodes = graph['nodes']
adjacency = {key: [] for key in nodes}
for edge in graph['edges']:
    adjacency[edge['from']].append(edge['to'])


def outcome(state, reader, observed):
    if observed == 'rejected':
        return state['phase'][reader] == 'rejected'
    return (state['phase'][reader] == 'delivered'
            and state['delivered'][reader] == observed)


def completion(first_result, second_result):
    """Find a completion preserving the observed invocation/await boundaries.

    First invocation precedes replacement's commit. The stale second invocation
    follows both first settlement and replacement completion. Transaction reads,
    validation and the first settlement's position relative to commit are hidden.
    Other reads performed by the fixture are omitted, not claimed verified here.
    """
    initial = graph['initial']
    pending = deque([initial])
    previous = {initial: None}
    while pending:
        current = pending.popleft()
        state = nodes[current]
        if outcome(state, 'first', first_result) and outcome(state, 'second', second_result):
            path = []
            while current is not None:
                path.append(current)
                current = previous[current]
            return list(reversed(path))
        for target in adjacency[current]:
            candidate = nodes[target]
            if target in previous or candidate['databaseBody'] == 2:
                continue
            first_phase = candidate['phase']['first']
            second_phase = candidate['phase']['second']
            if first_phase == 'idle':
                continue
            if state['phase']['first'] == 'idle' and (
                first_phase != 'queued' or candidate['databaseGeneration'] != 0
            ):
                continue
            if candidate['expected']['first'] != 0:
                continue
            if first_phase in {'delivered', 'rejected'} and not outcome(candidate, 'first', first_result):
                continue
            if second_phase != 'idle':
                if not outcome(candidate, 'first', first_result):
                    continue
                if candidate['databaseGeneration'] != 1 or candidate['expected']['second'] != 0:
                    continue
                if second_phase in {'delivered', 'rejected'} and not outcome(candidate, 'second', second_result):
                    continue
            previous[target] = current
            pending.append(target)
    return None


# Both legitimate overlap outcomes must be possible independently of which
# schedule happened to win this browser run.
assert completion(0, 'rejected')
assert completion('rejected', 'rejected')
assert {browser['name'] for browser in evidence['browsers']} == {'chromium', 'firefox'}
assert len(evidence['browsers']) == 2
samples = []
negative_controls = 0
for browser in evidence['browsers']:
    result = browser['result']
    assert len(result['overlap']) == 12
    assert len(set(result['generations'])) == 14
    assert result['publisherClaimIgnored'] and result['sameInstalledAt']
    for index, observation in enumerate(result['overlap']):
        assert observation['read'] in {'old-generation', 'rejected'}
        assert observation['staleReadRejected'] is True
        first_result = 0 if observation['read'] == 'old-generation' else 'rejected'
        witness = completion(first_result, 'rejected')
        assert witness, (browser['name'], index, observation)
        # Every possible safe internal schedule must reject each wrong byte
        # provenance, including an old-generation read succeeding after commit.
        for first, second in [(1, 'rejected'), (2, 'rejected'), (first_result, 0), (first_result, 1)]:
            assert completion(first, second) is None, (first, second)
            negative_controls += 1
        samples.append({
            'browser': browser['name'], 'version': browser['version'],
            'iteration': index, 'observation': observation,
            'possibleCompletion': witness,
        })
receipt = {
    'scope': 'Partial outcome correspondence; transaction linearization and validation are inferred, not observed',
    'inputs': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
               for path in [graph_path, evidence_path, root / 'test/context-generation.ts',
                            root / 'src/runtime/storage.ts', Path(__file__)]},
    'browserProvenance': evidence['provenance'],
    'fixtureSHA256': evidence['fixtureSHA256'],
    'observationsChecked': len(samples),
    'faultyOutcomesRejected': negative_controls,
    'samples': samples,
}
(directory / 'generation-implementation-traces.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(f'{len(samples)} observed overlap/stale pairs accepted; {negative_controls} faulty outcomes rejected')

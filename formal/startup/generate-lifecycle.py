#!/usr/bin/env python3
"""Generate the actual bounded LifecycleSafe TLC graph for trace comparison."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
directory = root / 'formal/startup'
model = root / 'formal/confinement'
jar = root / '.tools/tla2tools.jar'
jar_hash = 'fc6878c603f0fdc18b9fe3e5bf51860cb90ab5b1154e3c371660c036d6bdd63e'
assert hashlib.sha256(jar.read_bytes()).hexdigest() == jar_hash
image = 'eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
command = ('java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 '
           '-metadir /tmp/states -noGenerateSpecTE -dump dot,actionlabels /tmp/lifecycle.dot '
           '-config /work/formal/confinement/LifecycleSafe.cfg '
           '/work/formal/confinement/Lifecycle.tla >/dev/null && cat /tmp/lifecycle.dot')
dot = subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '-v',
                               f'{root}:/work:ro', '-w', '/tmp', image, 'sh', '-c', command], text=True)


def scalar(value):
    if value == 'TRUE':
        return True
    if value == 'FALSE':
        return False
    if value.startswith('"'):
        return json.loads(value)
    if value.isdigit():
        return int(value)
    if value in {'root', 'child'}:
        return value
    raise ValueError(value)


def parse_value(value):
    if value.startswith('(') and value.endswith(')'):
        result = {}
        for term in value[1:-1].split(' @@ '):
            key, item = term.split(' :> ')
            result[key] = scalar(item)
        if set(result) != {'root', 'child'}:
            raise ValueError(value)
        return result
    return scalar(value)


nodes, edges, initial = {}, [], []
for line in dot.splitlines():
    node = re.match(r'^(-?\d+) \[label="((?:\\.|[^"\\])*)"', line)
    edge = re.match(r'^(-?\d+) -> (-?\d+) \[label="((?:\\.|[^"\\])*)"', line)
    if node:
        label = json.loads('"' + node.group(2) + '"')
        fields = {}
        for field in label.splitlines():
            name, value = field.removeprefix('/\\ ').split(' = ', 1)
            fields[name] = parse_value(value)
        if set(fields) != {'phase', 'generation', 'owner', 'epoch', 'ranUnsafe',
                           'leakedAuthority', 'network', 'pendingGeneration',
                           'pendingRole', 'staleAccepted'}:
            raise ValueError(label)
        nodes[node.group(1)] = fields
        if 'style = filled' in line:
            initial.append(node.group(1))
    if edge:
        edges.append({'from': edge.group(1), 'to': edge.group(2),
                      'action': json.loads('"' + edge.group(3) + '"')})
assert len(initial) == 1 and nodes and edges
assert all(edge['from'] in nodes and edge['to'] in nodes for edge in edges)
receipt = {
    'scope': 'TLC LifecycleSafe finite graph; not a graph derived from TypeScript',
    'image': image,
    'jarSHA256': jar_hash,
    'inputs': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
               for path in [model / 'Lifecycle.tla', model / 'LifecycleSafe.cfg']},
    'initial': initial[0],
    'nodes': nodes,
    'edges': edges,
}
(directory / 'lifecycle-graph.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(f'{len(nodes)} Lifecycle states, {len(edges)} labeled TLC transitions')

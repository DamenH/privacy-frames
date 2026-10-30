#!/usr/bin/env python3
"""Generate admission outcomes and check model fault controls with TLC."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'formal/admission'
JAR = ROOT / '.tools/tla2tools.jar'
JAR_HASH = '011267fca25d0752cf18894dd585cd28b96960c112ea8a20b823ea770e7e10cd'
IMAGE = 'eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
if hashlib.sha256(JAR.read_bytes()).hexdigest() != JAR_HASH:
    raise SystemExit('TLA+ jar does not match the pinned release')

results = []
dot = ''
for name in ['Safe', 'HashA', 'HashB', 'Path', 'URL', 'PathURL', 'Entry']:
    options = ['-dump', 'dot,actionlabels', '/tmp/decision.dot'] if name == 'Safe' else []
    command = ['docker', 'run', '--rm', '--network', 'none', '-v', f'{ROOT}:/work:ro',
               '-w', '/tmp', IMAGE, 'java', '-cp', '/work/.tools/tla2tools.jar', 'tlc2.TLC',
               '-workers', '1', '-metadir', '/tmp/states', '-noGenerateSpecTE', *options,
               '-config', f'/work/formal/admission/{name}.cfg', '/work/formal/admission/Decision.tla']
    if name == 'Safe':
        command = ['docker', 'run', '--rm', '--network', 'none', '-v', f'{ROOT}:/work:ro',
                   '-w', '/tmp', IMAGE, 'sh', '-c',
                   'java -cp /work/.tools/tla2tools.jar tlc2.TLC -workers 1 -metadir /tmp/states '
                   '-noGenerateSpecTE -dump dot,actionlabels /tmp/decision.dot '
                   '-config /work/formal/admission/Safe.cfg /work/formal/admission/Decision.tla '
                   '>/tmp/check.log 2>&1 && cat /tmp/check.log && cat /tmp/decision.dot']
    run = subprocess.run(command, capture_output=True, text=True)
    output = run.stdout + run.stderr
    if name == 'Safe':
        if run.returncode or 'Model checking completed. No error has been found' not in output:
            raise SystemExit(output)
        dot = output
    elif run.returncode == 0 or 'Invariant NoInvalidAdmission is violated' not in output:
        raise SystemExit(f'Expected counterexample for {name}:\n{output}')
    results.append({'configuration': name, 'exitCode': run.returncode,
                    'expectedViolation': None if name == 'Safe' else 'NoInvalidAdmission',
                    'output': output if name != 'Safe' else output.split('digraph', 1)[0]})

cases = {}
for line in dot.splitlines():
    match = re.match(r'^(-?\d+) \[label="((?:\\.|[^"\\])*)"', line)
    if not match:
        continue
    label = json.loads('"' + match.group(2) + '"')
    fields = dict(re.findall(r'/\\ (\w+) = ("[^"]*"|TRUE|FALSE)', label))
    expected = {'hashA', 'hashB', 'uniquePath', 'uniqueURL', 'hasEntry', 'decision'}
    if set(fields) != expected:
        raise ValueError(label)
    if fields['decision'] == '"pending"':
        continue
    key = ''.join('1' if fields[field] == 'TRUE' else '0'
                  for field in ['hashA', 'hashB', 'uniquePath', 'uniqueURL', 'hasEntry'])
    if key in cases:
        raise ValueError('Duplicate modeled outcome: ' + key)
    cases[key] = json.loads(fields['decision'])
if len(cases) != 32:
    raise SystemExit(f'Expected 32 modeled inputs, got {len(cases)}')
inputs = [HERE / 'Decision.tla', *sorted(HERE.glob('*.cfg'))]
receipt = {'scope': 'Bounded abstract admission predicate; not an implementation or browser proof.',
           'image': IMAGE, 'jarSHA256': JAR_HASH,
           'inputs': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
           'results': results, 'cases': cases}
(HERE / 'model-results.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('32 modeled admission outcomes; six expected counterexamples')

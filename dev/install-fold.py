#!/usr/bin/env python3
"""Build and install Pi Edge on the paired Fold without changing plugin data."""
import hashlib
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = '/storage/emulated/0/Documents/Obsjiyu/Obsjiyu/.obsidian/plugins/pi-edge'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

devices = run('adb', 'devices', '-l').splitlines()[1:]
folds = [line.split()[0] for line in devices if ' device ' in line and 'model:SM_F976B' in line]
if len(folds) != 1:
    raise SystemExit('Connect exactly one paired Fold (SM_F976B) over ADB, then retry.')
adb = ['adb', '-s', folds[0]]
run(*adb, 'shell', 'test', '-f', DEST + '/manifest.json')
subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
for name in ('main.js', 'styles.css', 'manifest.json'):
    source = ROOT / name
    subprocess.run([*adb, 'push', str(source), DEST + '/' + name], check=True)
    expected = hashlib.sha256(source.read_bytes()).hexdigest()
    actual = run(*adb, 'shell', 'sha256sum', DEST + '/' + name).split()[0]
    if actual != expected:
        raise SystemExit(f'Hash mismatch: {name}')
print('Installed and verified on Fold. Reload Pi Edge in Obsidian to activate.')

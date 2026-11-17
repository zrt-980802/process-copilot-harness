"""Read-only, secret-free evidence for the isolated DEV-09 delivery test."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
EE = Path('E:/shanzi_workspace/feishu-ee-agents-dev09a')


def command(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True, encoding='utf-8', timeout=60).strip()


def snapshot(directory, phase):
    directory.mkdir(parents=True, exist_ok=True)
    ee_code = '''
import hashlib,json
from session.db import get_conn
tables=('eea_projects','eea_requirements','eea_functions','eea_requirement_functions',
 'eea_function_ssts_links','eea_ssts_document','eea_spec_section','eea_spec_review',
 'eea_harness_project_member','platform_accounts','platform_roles',
 'platform_account_roles','platform_role_permissions')
result={}
with get_conn() as conn:
 for name in tables:
  rows=sorted([dict(r) for r in conn.execute('SELECT * FROM '+name).fetchall()],key=lambda r:json.dumps(r,sort_keys=True,default=str))
  result[name]={'count':len(rows),'sha256':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
print(json.dumps(result))
'''
    business = json.loads(command('docker', 'exec', 'pc-workbench-demo-ee-api-1', 'python', '-c', ee_code))
    names = command('docker', 'ps', '-a', '--filter', 'name=pc-workbench-', '--format', '{{.Names}}').splitlines()
    containers = []
    for name in names:
        raw = json.loads(command('docker', 'inspect', name))[0]
        containers.append({key: value for key, value in {
            'name': name, 'id': raw['Id'], 'image_id': raw['Image'],
            'state': raw['State']['Status'], 'restarts': raw['RestartCount'],
            'health': raw['State'].get('Health', {}).get('Status'),
            'mounts': raw['Mounts'], 'networks': list(raw['NetworkSettings']['Networks']),
        }.items()})
    git = {}
    for name, path in [('product', ROOT), ('ee', EE)]:
        status = command('git', 'status', '--short', cwd=path)
        (directory / f'git-status-{name}-{phase}.txt').write_text(status, encoding='utf-8')
        files = command('git', 'ls-files', '-m', '-o', '--exclude-standard', cwd=path).splitlines()
        fingerprints = {}
        for item in files:
            file = path / item
            if file.is_file():
                fingerprints[item] = hashlib.sha256(file.read_bytes()).hexdigest()
        git[name] = {'path': str(path), 'head': command('git', 'rev-parse', 'HEAD', cwd=path),
                     'branch': command('git', 'branch', '--show-current', cwd=path), 'files': fingerprints}
    evidence = {'captured_at': datetime.now(timezone.utc).isoformat(), 'operator': 'Codex developer / test operator',
                'independent_acceptance': False, 'ee_tables': business, 'git': git, 'containers': containers,
                'networks': command('docker', 'network', 'ls', '--format', '{{.Name}}').splitlines(),
                'volumes': command('docker', 'volume', 'ls', '--format', '{{.Name}}').splitlines(),
                'versions': {'node': command('node', '--version'), 'pnpm': command('cmd', '/c', 'pnpm', '--version'),
                             'python': sys.version, 'docker': command('docker', 'version', '--format', '{{.Server.Version}}')}}
    (directory / f'environment-{phase}.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    (directory / f'data-baseline-{phase}.json').write_text(json.dumps(business, indent=2), encoding='utf-8')
    print(f'{phase}: captured {len(business)} EE table hashes, {len(containers)} containers and both worktrees')


if __name__ == '__main__':
    snapshot(Path(sys.argv[1]).resolve(), sys.argv[2])

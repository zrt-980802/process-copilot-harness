"""Repeat the real isolated seeds and compare existing business rows exactly."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = Path(sys.argv[1]).resolve()


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, encoding='utf-8', timeout=180).strip()


def state():
    code = '''
import json,hashlib
from session.db import get_conn
tables=('eea_projects','eea_requirements','eea_functions','eea_requirement_functions','eea_function_ssts_links',
 'eea_ssts_document','eea_spec_section','eea_spec_review','eea_harness_project_member',
 'platform_accounts','platform_roles','platform_account_roles','platform_role_permissions')
with get_conn() as c:
 rows={t:sorted([dict(r) for r in c.execute('SELECT * FROM '+t).fetchall()],key=lambda r:json.dumps(r,sort_keys=True,default=str)) for t in tables}
print(json.dumps({t:{'count':len(r),'sha256':hashlib.sha256(json.dumps(r,sort_keys=True,default=str).encode()).hexdigest()} for t,r in rows.items()}))
'''
    ee = json.loads(docker('exec', 'pc-workbench-demo-ee-api-1', 'python', '-c', code))
    pc = {}
    for table in ('pc_ssts_workspace', 'pc_ssts_input', 'pc_ssts_message', 'pc_ssts_draft', 'pc_ssts_review'):
        sql = "SELECT json_build_object('count',count(*),'md5',md5(COALESCE(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''))) FROM " + table + ' t'
        pc[table] = json.loads(docker('exec', 'pc-workbench-demo-pc-postgres-1', 'psql', '-U', 'pc_demo', '-d', 'pc_demo', '-Atc', sql))
    return {'ee': ee, 'pc': pc}


before = state()
docker('exec', 'pc-workbench-demo-ee-api-1', 'python', '-c', 'from ee_mcp_adapter.demo import initialize; initialize()')
result = subprocess.run([sys.executable, 'deploy/start-workbench-demo.py', 'run', '--rm', '--no-deps', 'seed'],
                        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=180)
if result.returncode:
    raise RuntimeError('PC seed failed; check local service logs')
after = state()
data = {'status': 'PASS' if before == after else 'FAIL', 'case_id': 'REC-010', 'before': before, 'after': after,
        'seed_stdout_sha256': hashlib.sha256(result.stdout.encode()).hexdigest()}
(EVIDENCE / 'seed-idempotency.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
assert before == after, 'Real seed changed existing business records; inspect seed-idempotency.json'
print('REC-010: real EE/PC seeds preserve all 13 EE and 5 PC business table hashes')

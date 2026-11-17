"""Local candidate freeze, repeatable developer replay and independent-test handoff."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ENTRY = Path('C:/Users/29557/Documents/ChatGPT/山子- PC')
EE = Path('E:/shanzi_workspace/feishu-ee-agents-dev09a')
PYTHON = sys.executable
ARCHIVE = ROOT / '.docker/dev09-candidates'
REPORTS = ROOT / 'reports/dev09-candidate'
SERVICES = ('ee-mysql', 'pc-postgres', 'ee-api', 'ee-mcp-adapter', 'pc-api', 'pc-runtime',
            'user-runtime-manager', 'seed', 'web', 'ee-admin-web')
STATE_FILES = ('seed-workbench-demo.mts', 'bootstrap-ee-demo-admin.py', 'workbench-demo-mysql-tests.yaml')


def stamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:6]


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def capture(args, cwd=ROOT, env=None, timeout=120):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=timeout)
    if result.returncode:
        raise RuntimeError('Command failed: ' + str(args[0]) + ' (exit ' + str(result.returncode) + ')')
    return result.stdout.strip()


def docker(*args, **kwargs):
    return capture(['docker', *args], **kwargs)


def repos():
    result = {}
    for name, path in [('product', ROOT), ('ee', EE)]:
        git = lambda *args: capture(['git', '-c', 'core.quotepath=false', *args], cwd=path)
        files = git('ls-files', '-z', '-c', '-o', '--exclude-standard').split('\0')
        result[name] = {'path': str(path), 'head': git('rev-parse', 'HEAD'), 'branch': git('branch', '--show-current'),
                        'status': git('status', '--porcelain=v1', '--untracked-files=all'),
                        'index': git('ls-files', '--stage'),
                        'files': {f: digest(path / f) for f in sorted(set(files)) if f and (path / f).is_file()},
                        'ignored_env_hashes': {p.name: digest(p) for p in path.glob('.env*') if p.is_file()}}
    return result


def inspect():
    names = docker('ps', '-a', '--filter', 'name=pc-workbench-', '--format', '{{.Names}}').splitlines()
    return json.loads(docker('inspect', *names)) if names else []


def safe_container(c):
    return {'name': c['Name'].lstrip('/'), 'id': c['Id'], 'image_id': c['Image'],
            'state': c['State']['Status'], 'paused': c['State'].get('Paused', False),
            'health': c['State'].get('Health', {}).get('Status'), 'restarts': c['RestartCount'],
            'mounts': c['Mounts'], 'networks': list(c['NetworkSettings']['Networks'])}


class Operator:
    def __init__(self, action, candidate=None, change_record=None):
        REPORTS.mkdir(parents=True, exist_ok=True)
        self.run = REPORTS / (stamp() + '-' + action)
        self.run.mkdir()
        self.steps = []
        self.action = action
        self.change_record = Path(change_record).resolve() if change_record else None
        if self.change_record and action != 'freeze':
            raise RuntimeError('A reviewed change record may only be supplied when freezing a new candidate')
        self.candidate = Path(candidate).resolve() if candidate else None
        if not self.candidate and action != 'freeze':
            directories = sorted(ARCHIVE.glob('*/candidate.json'))
            if not directories:
                raise RuntimeError('No frozen candidate; execute candidate.ps1 freeze first')
            self.candidate = directories[-1].parent
        self.secrets = set()
        self.env = dict(os.environ)
        for c in inspect():
            values = dict(e.split('=', 1) for e in c['Config'].get('Env', []) if '=' in e)
            for k, v in values.items():
                if re.search(r'(PASSWORD|SECRET|TOKEN|API_KEY)$', k) and len(v) >= 8:
                    self.secrets.add(v)
            if c['Name'] == '/pc-workbench-demo-pc-runtime-1':
                for key in ('DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'):
                    if values.get(key):
                        self.env[key] = values[key]
                self.env['PC_DEV09A_MODEL'] = values.get('DSH_MODEL', '')
        self.env.update(PC_DEMO_EE_ROOT=str(EE), PC_DEMO_PRODUCT_ROOT=str(ROOT))
        if self.candidate:
            self.env['PC_CANDIDATE_COMPOSE_FILES'] = json.dumps([str(self.candidate / name) for name in
                ('compose.workbench.json', 'compose.ee-admin.json', 'compose.pinned.json')])

    def redact(self, text):
        for value in sorted(self.secrets, key=len, reverse=True):
            text = text.replace(value, '[REDACTED]')
        text = re.sub(r'\bsk-[A-Za-z0-9_-]{24,}', '[REDACTED_API_KEY]', text)
        text = re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~-]{24,}', r'\1[REDACTED]', text)
        return re.sub(r'((?:postgres(?:ql)?|mysql)://)[^\s@]+@', r'\1[REDACTED]@', text)

    def execute(self, name, args, env=None, timeout=1200):
        print('RUN ' + name, flush=True)
        started = datetime.now(timezone.utc).isoformat()
        process = subprocess.Popen(args, cwd=ROOT, env=env or self.env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
        try:
            output, errors = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=20)
            else:
                process.kill()
            output, errors = process.communicate(timeout=20)
            (self.run / (name + '.log')).write_text(self.redact(output + '\n' + errors), encoding='utf-8')
            self.steps.append({'name': name, 'started_at': started, 'status': 'FAIL', 'exit_code': None,
                               'reason': 'timeout', 'log': name + '.log'})
            raise RuntimeError(name + ' timed out; diagnostics retained') from None
        (self.run / (name + '.log')).write_text(self.redact(output + '\n' + errors), encoding='utf-8')
        self.steps.append({'name': name, 'started_at': started, 'exit_code': process.returncode,
                           'status': 'PASS' if process.returncode == 0 else 'FAIL', 'log': name + '.log'})
        if process.returncode:
            raise RuntimeError(name + ' failed; see ' + str(self.run / (name + '.log')))

    def checkpoint(self, name):
        write(self.run / (name + '.json'), {'repositories': repos(), 'containers': [safe_container(c) for c in inspect()]})

    def validate(self):
        frozen = read(self.candidate / 'candidate.json')
        assert repos() == frozen['repositories'], 'Source/index/dirty state drift; freeze a new candidate after review'
        for service, image in frozen['images'].items():
            assert docker('image', 'inspect', image['tag'], '--format', '{{.Id}}') == image['id'], 'Pinned image drift: ' + service
        for name, expected in frozen['package_hashes'].items():
            assert digest(self.candidate / name) == expected, 'Frozen package drift: ' + name
        actual = {c['Name'].lstrip('/'): c for c in inspect()}
        for service, expected in frozen['environment'].items():
            name = 'pc-workbench-demo-' + service + '-1'
            if name in actual:
                values = dict(x.split('=', 1) for x in actual[name]['Config'].get('Env', []) if '=' in x)
                selected = {key: values.get(key) for key in expected['keys']}
                value_hash = hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()
                assert value_hash == expected['sha256'], 'Running configuration drift: ' + service
        return frozen

    def compose(self, *args):
        return ['docker', 'compose', '-p', 'pc-workbench-demo',
                '-f', str(self.candidate / 'compose.workbench.json'),
                '-f', str(self.candidate / 'compose.ee-admin.json'),
                '-f', str(self.candidate / 'compose.pinned.json'), *args]

    def freeze(self):
        self.candidate = ARCHIVE / stamp()
        self.candidate.mkdir(parents=True)
        previous = ROOT / 'reports/dev09-minimum-delivery/20261112-t0-t7-01/frozen-source.json'
        if previous.exists():
            prior = read(previous)
            change = read(self.change_record) if self.change_record else {}
            approved = change.get('source_changes', {})
            observed = {}
            current_sources = repos()
            if change:
                baseline_path = Path(change['baseline_candidate']) / 'candidate.json'
                assert digest(baseline_path) == change['baseline_manifest_sha256'], 'Reviewed baseline manifest drift'
                assert change.get('defect_id') and change.get('reason'), 'A defect and review reason are required'
                write(self.candidate / 'source-change-record.json', change)
            for name, workspace in prior['source'].items():
                current_files = current_sources[name]['files']
                for path in workspace['files'].keys() | current_files.keys():
                    if name == 'ee' or path.startswith(('apps/', 'packages/', 'profiles/')):
                        expected = workspace['files'].get(path)
                        current = current_files.get(path)
                        if current != expected:
                            pair = {'before': expected, 'after': current}
                            assert approved.get(name, {}).get(path) == pair, 'Unreviewed business source drift since T0-T7: ' + path
                            observed.setdefault(name, {})[path] = pair
            assert observed == approved, 'Reviewed source list does not match the exact observed changes'
            write(self.candidate / 'prior-business-source.json', {'status': 'PASS', 'previous_manifest_sha256': digest(previous),
                  'reviewed_source_changes': observed})
        self.execute('build-test-bundles', ['node', 'deploy/build-candidate-tests.mjs', str(self.candidate / 'tests')])
        self.execute('build-test-runner', ['docker', 'build', '-f', 'deploy/candidate-tests.Dockerfile',
                     '-t', 'process-copilot-candidate-tests:local', '.'], timeout=600)
        # Config is parsed structurally in memory; only the source templates without resolved credentials are retained.
        import yaml
        templates = {}
        for source, target in [('docker-compose.workbench-demo.yml', 'compose.workbench.json'),
                               ('docker-compose.ee-admin.yml', 'compose.ee-admin.json')]:
            value = yaml.safe_load((ROOT / 'deploy' / source).read_text(encoding='utf-8'))
            templates.update(value['services'])
            write(self.candidate / target, value)
        current = {c['Name'].lstrip('/'): c for c in inspect()}
        images = {}
        override = {}
        recovered = {}
        for service in SERVICES:
            c = current['pc-workbench-demo-' + service + '-1']
            tag = 'pc-dev09-candidate-' + self.candidate.name.lower() + '-' + service + ':frozen'
            probe = subprocess.run(['docker', 'image', 'inspect', c['Image']], capture_output=True)
            image_id = c['Image']
            if probe.returncode:
                assert service in ('ee-api', 'ee-mcp-adapter', 'seed', 'ee-admin-web'), 'Missing Runtime/database image requires separate repair'
                if image_id not in recovered:
                    tar = self.candidate / (service + '-filesystem.tar')
                    self.execute('preserve-filesystem-' + service, ['docker', 'export', '-o', str(tar), c['Name'].lstrip('/')], timeout=300)
                    config = c['Config']
                    changes = []
                    for instruction, value in [('WORKDIR', config.get('WorkingDir')), ('USER', config.get('User'))]:
                        if value:
                            changes += ['--change', instruction + ' ' + value]
                    for instruction, key in [('ENTRYPOINT', 'Entrypoint'), ('CMD', 'Cmd')]:
                        if config.get(key):
                            changes += ['--change', instruction + ' ' + json.dumps(config[key])]
                    path = next(v for v in config['Env'] if v.startswith('PATH='))
                    changes += ['--change', 'ENV ' + path]
                    self.execute('import-preserved-' + service, ['docker', 'import', *changes, str(tar), tag], timeout=300)
                    recovered[image_id] = docker('image', 'inspect', tag, '--format', '{{.Id}}')
                image_id = recovered[image_id]
            docker('image', 'tag', image_id, tag)
            images[service] = {'tag': tag, 'id': image_id, 'source_image_id': c['Image'],
                               'preserved_from_container': c['Id'] if probe.returncode else None}
            override[service] = {'image': tag}
        runner_id = docker('image', 'inspect', 'process-copilot-candidate-tests:local', '--format', '{{.Id}}')
        tag = 'pc-dev09-candidate-' + self.candidate.name.lower() + '-tests:frozen'
        docker('image', 'tag', runner_id, tag)
        images['test-runner'] = {'tag': tag, 'id': runner_id}
        write(self.candidate / 'compose.pinned.json', {'services': override})
        data = self.data()
        write(self.candidate / 'data-at-freeze.json', data)
        for name in STATE_FILES:
            (self.candidate / name).write_bytes((ROOT / 'deploy' / name).read_bytes())
        hashes = {p.relative_to(self.candidate).as_posix(): digest(p) for p in self.candidate.rglob('*') if p.is_file()}
        environment = {}
        for service in SERVICES:
            values = dict(x.split('=', 1) for x in current['pc-workbench-demo-' + service + '-1']['Config'].get('Env', []) if '=' in x)
            keys = sorted(templates[service].get('environment', {}))
            selected = {key: values.get(key) for key in keys}
            environment[service] = {'keys': keys, 'sha256': hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()}
        write(self.candidate / 'candidate.json', {'candidate_id': self.candidate.name,
              'captured_at': datetime.now(timezone.utc).isoformat(), 'repositories': repos(), 'images': images,
              'environment': environment,
              'package_hashes': hashes, 'containers': [safe_container(c) for c in current.values()],
              'services': list(SERVICES), 'evidence_root': str(REPORTS), 'data': data,
              'independent_acceptance': 'NOT_RUN', 'scope': 'docs/dev09-candidate/scope.md'})
        write(self.run / 'frozen-candidate.json', {'path': str(self.candidate), 'sha256': digest(self.candidate / 'candidate.json')})

    def health(self):
        deadline = time.monotonic() + 150
        last_error = ''
        while time.monotonic() < deadline:
            try:
                frozen = read(self.candidate / 'candidate.json')
                items = inspect()
                by_name = {c['Name'].lstrip('/'): c for c in items}
                for service in SERVICES:
                    c = by_name['pc-workbench-demo-' + service + '-1']
                    assert c['Image'] == frozen['images'][service]['id'], 'Wrong image: ' + service
                    if service == 'seed':
                        assert c['State']['Status'] == 'exited' and c['State']['ExitCode'] == 0, 'Seed did not finish'
                    else:
                        assert c['State']['Status'] == 'running' and not c['State'].get('Paused'), service
                        assert c['State'].get('Health', {}).get('Status', 'healthy') == 'healthy', service
                for url in ('http://127.0.0.1:18091/', 'http://127.0.0.1:18091/api/ready',
                            'http://127.0.0.1:18092/access-control'):
                    assert urlopen(url, timeout=4).status == 200, url
                for c in items:
                    if c['Name'].startswith('/pc-workbench-user-'):
                        assert c['Image'] == frozen['images']['pc-runtime']['id'], 'User Runtime image drift'
                        state = json.loads(docker('exec', c['Name'].lstrip('/'), 'node', '-e',
                          "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"))
                        assert state['active_sessions'] == 0 and state['revoking_sessions'] == 0
                return {'status': 'PASS', 'containers': [safe_container(c) for c in items]}
            except Exception as error:
                last_error = str(error)
                time.sleep(2)
        raise RuntimeError('Health gate timed out: ' + last_error)

    def data(self):
        code = """
import json,hashlib
from session.db import get_conn
tables=('eea_projects','eea_requirements','eea_functions','eea_requirement_functions','eea_function_ssts_links','eea_ssts_document','eea_spec_section','eea_spec_review')
with get_conn() as c:
 rows={t:sorted([dict(r) for r in c.execute('SELECT * FROM '+t).fetchall()],key=lambda r:json.dumps(r,sort_keys=True,default=str)) for t in tables}
 members=[dict(r) for r in c.execute('SELECT project_code,account_id,role FROM eea_harness_project_member ORDER BY project_code,account_id').fetchall()]
 accounts=[dict(r) for r in c.execute('SELECT id,username,status FROM platform_accounts ORDER BY id').fetchall()]
 roles=[dict(r) for r in c.execute('SELECT account_id,role_id FROM platform_account_roles ORDER BY account_id,role_id').fetchall()]
 permissions=[dict(r) for r in c.execute('SELECT rp.role_id,p.permission_key,rp.effect FROM platform_role_permissions rp JOIN platform_permissions p ON p.id=rp.permission_id ORDER BY rp.role_id,p.permission_key').fetchall()]
print(json.dumps({'business':{t:hashlib.sha256(json.dumps(r,sort_keys=True,default=str).encode()).hexdigest() for t,r in rows.items()},'members':members,'accounts':accounts,'roles':roles,'permissions':permissions}))
"""
        return json.loads(docker('exec', 'pc-workbench-demo-ee-api-1', 'python', '-c', code))

    def start(self):
        frozen = self.validate()
        self.execute('start-pinned-services', self.compose('up', '-d', '--no-build', '--pull', 'never', '--no-recreate'), timeout=300)
        for service in SERVICES:
            name = 'pc-workbench-demo-' + service + '-1'
            image_id = docker('inspect', name, '--format', '{{.Image}}')
            if image_id != frozen['images'][service]['id']:
                assert frozen['images'][service].get('preserved_from_container'), 'Unapproved running image drift: ' + service
                self.execute('restore-preserved-' + service, self.compose('up', '-d', '--no-build', '--pull', 'never',
                             '--no-deps', '--force-recreate', service), timeout=300)
                for _ in range(75):
                    state = json.loads(docker('inspect', '--format', '{{json .State}}', name))
                    if (service == 'seed' and state['Status'] == 'exited' and state['ExitCode'] == 0
                            or service != 'seed' and state['Status'] == 'running'
                            and state.get('Health', {}).get('Status', 'healthy') == 'healthy'):
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError('Preserved service did not recover: ' + service)
        for c in inspect():
            if c['Name'].startswith('/pc-workbench-user-') and c['State']['Status'] != 'running':
                docker('start', c['Name'].lstrip('/'))
        write(self.run / 'health.json', self.health())

    def prepare(self):
        target = self.run / 'prepare'
        target.mkdir()
        self.execute('seed-repeat', [PYTHON, 'deploy/verify-minimum-seed.py', str(target)], timeout=300)
        assert read(target / 'seed-idempotency.json')['status'] == 'PASS'

    def phase(self, phase, tag, target):
        env = dict(self.env, PC_TEST_EVIDENCE_DIR=str(target), PC_TEST_RUN_TAG=tag, PC_TEST_TASK_NAMESPACE=self.run.name)
        self.execute(phase + '-' + tag, ['node', 'deploy/verify-minimum-delivery.mjs', phase], env)

    def verify(self):
        frozen = self.validate()
        self.checkpoint('before')
        state = {c['Name']: c['State']['Status'] for c in inspect()}
        online = all(state.get('/pc-workbench-demo-' + service + '-1') == 'running' for service in ('ee-api', 'ee-mysql'))
        original = self.data() if online else None
        self.start()
        if original is None:
            original = self.data()
            for key in ('business', 'members', 'permissions'):
                assert original[key] == frozen['data'][key], 'Offline retained baseline drift: ' + key
        write(self.run / 'data-before.json', original)
        self.prepare()
        first_start = self.data()
        assert first_start == original, 'Start/seed changed existing business or authority state'
        self.execute('repeat-start', self.compose('up', '-d', '--no-build', '--pull', 'never', '--no-recreate'), timeout=300)
        self.health()
        assert self.data() == original, 'Repeated startup changed retained data'
        target = self.run / 't0-t7'
        target.mkdir()
        self.execute('snapshot-before', [PYTHON, 'deploy/minimum-delivery-snapshot.py', str(target), 'before'])
        self.phase('baseline', 'MIN01', target)
        self.execute('product-check-final', ['cmd', '/c', 'pnpm', 'check'])
        self.execute('git-diff-check', ['git', 'diff', '--check'])
        (target / 'product-check-final.log').write_bytes((self.run / 'product-check-final.log').read_bytes())
        config = '/tmp/candidate-mysql-' + uuid4().hex + '.yaml'
        docker('cp', str(self.candidate / 'workbench-demo-mysql-tests.yaml'), 'pc-workbench-demo-ee-api-1:' + config)
        self.execute('ee-tests', ['docker', 'exec', '-e', 'DEV09A_MYSQL_TEST_CONFIG=' + config,
                     '-w', '/ee/backend', 'pc-workbench-demo-ee-api-1', 'python', '-m', 'pytest',
                     'tests/process_copilot_mcp', '-v'], timeout=600)
        (target / 'ee-tests.log').write_bytes((self.run / 'ee-tests.log').read_bytes())
        runner = 'pc-candidate-tests-' + uuid4().hex[:12]
        write(self.run / 'test-runner.json', {'container': runner, 'retained_on_failure': True})
        self.execute('create-test-runner', ['docker', 'run', '-d', '--name', runner,
                     '--network', 'pc-workbench-demo_control', '-v', str(self.candidate / 'tests') + ':/runner/tests:ro',
                     frozen['images']['test-runner']['tag']])
        runtime_values = json.loads(docker('inspect', '--format', '{{json .Config.Env}}', 'pc-workbench-demo-pc-api-1'))
        test_env = dict(self.env, **dict(x.split('=', 1) for x in runtime_values if '=' in x))
        test_env['PC_TEST_POSTGRES_URL'] = 'postgres://pc_demo:local-pc-demo-only@pc-postgres:5432/pc_unified_login_test'
        names = docker('exec', 'pc-workbench-demo-pc-postgres-1', 'psql', '-U', 'pc_demo', '-d', 'postgres',
                       '-Atc', "SELECT datname FROM pg_database WHERE datname='pc_unified_login_test'")
        assert names == 'pc_unified_login_test', 'Expected retained isolated test database missing; do not create or migrate business schema'
        self.execute('postgres-tests-executed', ['docker', 'exec', '-e', 'PC_TEST_POSTGRES_URL', runner,
                     '/runner/node_modules/.bin/vitest', 'run', '--maxWorkers', '1', '--no-file-parallelism',
                     '--reporter=verbose', '/runner/tests'], test_env)
        for script, outfile in [('verify-unified-login-postgres', 'postgres-real-ee-login.json'),
                                ('verify-minimum-mcp-faults', 'mcp-real-faults.json')]:
            self.execute(script, ['docker', 'exec', '-e', 'EECLAW_ADAPTER_SECRET', '-e', 'EE_MCP_ADAPTER_SECRET',
                         runner, 'node', '/runner/tests/' + script + '.mjs'], test_env)
            source = '/tmp/unified-postgres-result.json' if script == 'verify-unified-login-postgres' else '/tmp/minimum-mcp-faults.json'
            docker('cp', runner + ':' + source, str(target / outfile))
            assert read(target / outfile)['status'] == 'PASS'
        (target / 'postgres-tests-executed.log').write_bytes((self.run / 'postgres-tests-executed.log').read_bytes())
        self.execute('stop-successful-test-runner', ['docker', 'stop', runner])
        self.browser('auth-final', 'verify-unified-login.mjs', target / 'auth-final')
        self.phase('auth-extra', 'MIN01', target)
        self.phase('permissions', 'AUTHORITY_FINAL', target)
        self.phase('mcp', 'MIN02', target)
        for i in range(1, 4):
            tag = 'FIXED_R' + str(i)
            directory = target / ('chat-fixed-round-' + str(i))
            self.browser('chat-round-' + str(i), 'verify-multi-user-conversation.mjs', directory, tag)
            self.browser('runtime-boundaries-' + str(i), 'verify-user-runtime-boundaries.mjs', directory, tag)
            self.phase('chat-extra', tag, target)
            self.phase('chat-completion', 'FINAL_COMPLETE_R' + str(i), target)
        self.browser('markdown', 'verify-workbench-markdown.mjs', target / 'markdown')
        self.phase('regression', 'REG_RETEST', target)
        self.phase('recovery', 'COMPLETE', target)
        # Legacy evidence names remain available to the existing case indexer, but all rows are fresh.
        for name in ('recovery-FINAL.json', 'recovery-REC_FINAL.json', 'recovery-REC_ADAPTER_FINAL.json'):
            (target / name).write_bytes((target / 'recovery-COMPLETE.json').read_bytes())
        self.phase('permission-cache', 'CACHE_FINAL', target)
        self.execute('seed-idempotency', [PYTHON, 'deploy/verify-minimum-seed.py', str(target)], timeout=300)
        self.phase('final-state', 'FINAL', target)
        self.execute('snapshot-after', [PYTHON, 'deploy/minimum-delivery-snapshot.py', str(target), 'after'])
        self.execute('case-summary', ['node', 'deploy/finalize-minimum-delivery.mjs', str(target),
                     str(ENTRY / 'migration/DEV-09-MINIMUM-DELIVERY-TEST-PLAN.md')])
        after = self.data()
        write(self.run / 'data-after.json', after)
        assert after['business'] == original['business'], 'EE business data drift'
        for key in ('members', 'permissions'):
            assert after[key] == original[key], 'Authority drift: ' + key
        previous = {a['id']: a for a in original['accounts']}
        assert all(a == previous[a['id']] if a['id'] in previous else a['status'] == 'disabled' for a in after['accounts'])
        assert all(r in after['roles'] for r in original['roles'])
        self.checkpoint('after')
        self.validate()
        write(self.run / 'health-after.json', self.health())
        write(self.run / 'defects.json', [])

    def browser(self, name, script, target, tag=''):
        target.mkdir(parents=True, exist_ok=True)
        env = dict(self.env, PC_TEST_EVIDENCE_DIR=str(target), PC_TEST_RUN_TAG=self.run.name + '_' + tag)
        self.execute(name, ['node', 'deploy/' + script], env)

    def diagnostics(self):
        try:
            write(self.run / 'failure-containers.json', [safe_container(c) for c in inspect()])
            for c in inspect():
                result = subprocess.run(['docker', 'logs', '--tail', '400', c['Name'].lstrip('/')], capture_output=True,
                                        text=True, encoding='utf-8', errors='replace', timeout=20)
                (self.run / (c['Name'].lstrip('/') + '.log')).write_text(self.redact(result.stdout + result.stderr), encoding='utf-8')
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('freeze', 'start', 'health', 'prepare', 'verify', 'stop', 'rollback', 'status'))
    parser.add_argument('--candidate')
    parser.add_argument('--change-record')
    args = parser.parse_args()
    operator = None
    lock = REPORTS / '.operator.lock'
    REPORTS.mkdir(parents=True, exist_ok=True)
    try:
        with lock.open('x', encoding='utf-8') as stream:
            stream.write(str(os.getpid()))
    except FileExistsError:
        print('NOT_READY: Another operator owns the lock; inspect the process before removing a stale lock', flush=True)
        return 1
    status, blocker = 'NOT_READY', None
    try:
        operator = Operator(args.action, args.candidate, args.change_record)
        if args.action == 'freeze':
            operator.freeze()
        elif args.action == 'health':
            operator.validate()
            write(operator.run / 'health.json', operator.health())
        elif args.action == 'status':
            operator.validate()
        elif args.action == 'stop':
            operator.validate()
            for c in inspect():
                if c['State']['Status'] == 'running':
                    docker('stop', '--time', '30', c['Name'].lstrip('/'))
        elif args.action == 'rollback':
            operator.validate()
            operator.execute('restore-pinned-services', operator.compose('up', '-d', '--no-build', '--pull', 'never', '--force-recreate'), timeout=300)
            write(operator.run / 'health.json', operator.health())
        else:
            getattr(operator, args.action)()
        if args.action == 'verify':
            status = 'READY_FOR_INDEPENDENT_ACCEPTANCE'
    except Exception as error:
        blocker = str(error)
        if operator:
            operator.diagnostics()
            write(operator.run / 'defects.json', [{'id': 'RUN-001', 'severity': 'P1', 'status': 'OPEN',
              'steps': 'Execute candidate.ps1 ' + args.action, 'account': 'See failed step evidence',
              'project': 'Isolated pc-workbench-demo', 'expected': 'All prerequisites and checks succeed',
              'actual': operator.redact(blocker), 'logs': str(operator.run),
              'impact': 'Candidate readiness blocked; retained containers, volumes and evidence',
              'regression': 'Re-run the failed case and full verify in a new evidence directory'}])
    finally:
        if operator:
            write(operator.run / 'result.json', {'status': status, 'action': args.action,
              'action_completed': blocker is None, 'candidate': str(operator.candidate), 'steps': operator.steps,
              'blockers': [operator.redact(blocker)] if blocker else [], 'independent_acceptance': 'NOT_RUN'})
            print(str(operator.run), flush=True)
        lock.unlink(missing_ok=True)
    print(status + (': ' + (operator.redact(blocker) if operator else blocker) if blocker else ''), flush=True)
    return 1 if blocker else 0


if __name__ == '__main__':
    raise SystemExit(main())

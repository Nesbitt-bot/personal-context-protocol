"""Grant-checked command execution in disposable, networkless containers."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

ROOT = Path(os.environ['EXECUTION_WORKSPACE_ROOT'])
PCP = os.environ.get('PCP_URL', 'http://127.0.0.1:3000').rstrip('/')
IMAGE = os.environ.get('EXECUTION_IMAGE', 'python:3.12-slim')
SLOTS = threading.BoundedSemaphore(2)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def send(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        self.send(200 if self.path == '/healthz' else 404, {'status': 'ok'})

    def do_POST(self):
        name = None
        acquired = False
        try:
            if self.path != '/v1/execute': return self.send(404, {'error': 'Execution unavailable: runner/route - unknown endpoint'})
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 16384: return self.send(413, {'error': 'Execution refused: runner/body - request exceeds sixteen KiB'})
            body = json.loads(self.rfile.read(size))
            if set(body) != {'session_key', 'command'} or not isinstance(body['command'], str) or not 1 <= len(body['command']) <= 8000:
                return self.send(400, {'error': 'Execution refused: runner/validation - session key and bounded command required'})
            request = urllib.request.Request(PCP + '/api/v1/service/execution', data=json.dumps({'session_key': body['session_key'], 'tool_name': 'pcp_execute'}).encode(),
                                            headers={'Authorization': self.headers.get('Authorization', ''), 'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=8) as response: grant = json.load(response)
            except urllib.error.HTTPError as error:
                return self.send(403 if error.code < 500 else 503, {'error': 'Execution refused: runner/grant - PCP did not authorize this tool'})
            if grant.get('allowed') is not True or not isinstance(grant.get('workspace_key'), str):
                return self.send(403, {'error': 'Execution refused: runner/grant - no isolated workspace authorized'})
            acquired = SLOTS.acquire(blocking=False)
            if not acquired: return self.send(429, {'error': 'Execution deferred: runner/capacity - both execution slots are busy'})
            workspace = ROOT / hashlib.sha256(grant['workspace_key'].encode()).hexdigest()
            workspace.mkdir(parents=True, exist_ok=True, mode=0o700); os.chown(workspace, 1000, 1000)
            name = f'pcp-action-{time.time_ns()}'
            subprocess.run(['docker', 'run', '-d', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                            '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
                            '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--log-driver', 'local', '--log-opt', 'max-size=128k', '--log-opt', 'max-file=1', '--log-opt', 'compress=false',
                            '--mount', f'type=bind,src={workspace},dst=/workspace', '-w', '/workspace', IMAGE, 'sh', '-lc', body['command']],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
            timed_out = False
            try:
                result = subprocess.run(['docker', 'wait', name], capture_output=True, text=True, timeout=30)
                code = int(result.stdout.strip()) if result.returncode == 0 else 1
            except subprocess.TimeoutExpired:
                timed_out = True; code = 124
                subprocess.run(['docker', 'kill', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            logs = subprocess.run(['docker', 'logs', '--tail', '500', name], capture_output=True, timeout=10)
            output = (logs.stdout + logs.stderr)[:131072].decode(errors='replace')
            self.send(200, {'exit_code': code, 'output': output, 'timed_out': timed_out})
        except Exception:
            self.send(503, {'error': 'Execution unavailable: runner/container lifecycle - grant, runtime or resource operation failed'})
        finally:
            if name: subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            if acquired: SLOTS.release()


if __name__ == '__main__':
    print('Execution runner listening on loopback; every command requires a live PCP grant.', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 3103), Handler).serve_forever()

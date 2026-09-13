"""Run after building kadr-anime:local and kadr-extractor:local. No host ports or durable data."""
import subprocess
import time
import uuid
from pathlib import Path
suffix=uuid.uuid4().hex[:10]
network='kadr-check-'+suffix
container='kadr-extractor-'+suffix

def run(*args,**kwargs):
    return subprocess.run(['docker',*args],check=True,**kwargs)
try:
    run('network','create',network,stdout=subprocess.DEVNULL)
    run('run','-d','--name',container,'--network',network,'--network-alias','extractor',
        '--read-only','--tmpfs','/tmp:size=32m','kadr-extractor:local',stdout=subprocess.DEVNULL)
    for _ in range(40):
        r=subprocess.run(['docker','exec',container,'python','-c',
            "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)"],capture_output=True)
        if r.returncode==0:break
        time.sleep(.25)
    else:raise RuntimeError('Extractor did not start')
    run('run','--rm','-i','--network',network,'--tmpfs','/app/data:uid=1000,gid=1000',
        '-e','APP_ORIGIN=http://127.0.0.1:3000','-e','COOKIE_SECURE=false',
        '-e','EXTRACTOR_URL=http://extractor:8000','kadr-anime:local','node','--input-type=module',
        input=Path('tests/docker-smoke.mjs').read_bytes())
finally:
    subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

"""Exercise release selection and rollback without SSH, Docker or user data."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/deploy.sh'


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='kadr-deploy-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ['bin', 'incoming', 'shared', 'releases']:
            (self.root / name).mkdir()
        (self.root / 'shared/.env').write_text('APP_ORIGIN=https://example.test\n')
        self.old = 'a' * 40
        self.new = 'b' * 40
        previous = self.root / 'releases' / self.old
        previous.mkdir()
        (self.root / 'current').symlink_to(previous)
        archive = self.root / 'incoming' / (self.new + '.tar.gz')
        with tarfile.open(archive, 'w:gz') as tar:
            for name in ['compose.production.yaml', 'images.env']:
                content = b'services: {}\n'
                info = tarfile.TarInfo(name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))
        self.digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.log = self.root / 'calls'
        # Locking belongs to flock itself, not this mock-based flow test.
        for name, content in {
            'flock': '#!/bin/sh\nexit 0\n',
            'docker': '''#!/bin/sh
printf '%s %s\\n' "$DEPLOY_SHA" "$*" >> "$TEST_LOG"
case "$*" in
  *' build') exit 99;;
  *' pull') [ "$FAIL_PULL" != 1 ] || exit 7;;
  *' up '*) [ "$FAIL_UP" != "$DEPLOY_SHA" ] || exit 8;;
esac
exit 0
''',
        }.items():
            path = self.root / 'bin' / name
            path.write_text(content)
            path.chmod(0o700)

    def run_deploy(self, **extra):
        return subprocess.run(['bash', str(SCRIPT), str(self.root), self.new,
                               self.digest, 'test-kadr'], text=True, capture_output=True,
                              env={**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'],
                                   'TEST_LOG': str(self.log), **extra})

    def test_success_advances_current_without_removing_data(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'current').resolve().name, self.new)
        self.assertTrue((self.root / 'shared/.env').exists())
        self.assertNotIn(' down', self.log.read_text())
        self.assertIn('--no-build --pull never --wait', self.log.read_text())
        self.assertNotIn(' build', self.log.read_text())
        self.assertLess(self.log.read_text().index(' pull'), self.log.read_text().index(' up '))

    def test_unhealthy_release_rolls_back_and_fails_job(self):
        result = self.run_deploy(FAIL_UP=self.new)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / 'current').resolve().name, self.old)
        self.assertIn(self.old + ' compose', self.log.read_text())
        self.assertIn('Restored containers', result.stderr)

    def test_ghcr_rollback_uses_previous_digest_file(self):
        previous = self.root / 'releases' / self.old
        (previous / 'images.env').write_text('APP_IMAGE=old-digest\n')
        result = self.run_deploy(FAIL_UP=self.new)
        self.assertNotEqual(result.returncode, 0)
        rollback_call = self.log.read_text().splitlines()[-1]
        self.assertIn(str(previous / 'images.env'), rollback_call)
        self.assertIn('--pull never', rollback_call)
        self.assertNotIn(' build', self.log.read_text())

    def test_pull_failure_does_not_restart_running_services(self):
        result = self.run_deploy(FAIL_PULL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(' up ', self.log.read_text())
        self.assertEqual((self.root / 'current').resolve().name, self.old)

    def test_redeploy_current_sha_reuses_images(self):
        self.assertEqual(self.run_deploy().returncode, 0)
        # A retry receives another archive, even when current already points to it.
        archive = self.root / 'incoming' / (self.new + '.tar.gz')
        archive.write_bytes(b'already extracted')
        self.digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.log.write_text('')
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(' build', self.log.read_text())

    def test_bad_checksum_stops_before_docker(self):
        self.digest = '0' * 64
        self.assertNotEqual(self.run_deploy().returncode, 0)
        self.assertFalse(self.log.exists())

    def test_first_failed_release_has_no_rollback_target(self):
        (self.root / 'current').unlink()
        result = self.run_deploy(FAIL_UP=self.new)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'current').exists())
        self.assertIn('No previous release', result.stderr)


if __name__ == '__main__':
    unittest.main()

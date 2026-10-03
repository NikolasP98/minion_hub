"""Exercise the actual harness admission before any browser call can occur."""
import os
import runpy
import tempfile
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('verify.py')

class FixtureAdmission(TestCase):
    def test_loopback_and_evidence_boundaries(self):
        with tempfile.TemporaryDirectory(prefix='button-evidence-admission-') as directory:
            root = Path(directory)
            for side in ['before', 'after']:
                (root / side).mkdir()
                (root / side / 'fixture-manifest.json').write_text('{}')
            environment = {
                'MINION_BUTTON_EVIDENCE_OUT': directory,
                'MINION_BUTTON_BEFORE_MANIFEST': 'before/fixture-manifest.json',
                'MINION_BUTTON_AFTER_MANIFEST': 'after/fixture-manifest.json',
                'MINION_BUTTON_PROOF_FILE': 'fresh-proof.json',
                'MINION_BUTTON_BEFORE_URL': 'http://127.0.0.1:4427',
                'MINION_BUTTON_AFTER_URL': 'http://localhost:4426/',
            }
            calls = []
            def browser_start(url):
                calls.append(url)
                raise RuntimeError('reached-native-browser-boundary')
            with patch.dict(os.environ, environment):
                with self.assertRaisesRegex(RuntimeError, 'reached-native-browser-boundary'):
                    runpy.run_path(str(SCRIPT), init_globals={'new_tab': browser_start})
            self.assertEqual(calls, ['http://127.0.0.1:4427'])
            cases = [
                ('MINION_BUTTON_BEFORE_URL', 'https://production.example:443'),
                ('MINION_BUTTON_AFTER_URL', 'http://example.com:4426'),
                ('MINION_BUTTON_AFTER_URL', 'http://127.0.0.1:4426/app'),
                ('MINION_BUTTON_AFTER_URL', 'http://user:secret@localhost:4426'),
                ('MINION_BUTTON_AFTER_URL', 'http://localhost:80'),
                ('MINION_BUTTON_AFTER_URL', 'http://localhost:70000'),
                ('MINION_BUTTON_AFTER_URL', 'http://localhost:4426?redirect=external'),
                ('MINION_BUTTON_PROOF_FILE', '../escape.json'),
                ('MINION_BUTTON_PROOF_FILE', '/tmp/escape.json'),
                ('MINION_BUTTON_PROOF_FILE', 'nested/proof.json'),
                ('MINION_BUTTON_PROOF_FILE', 'not-json.txt'),
                ('MINION_BUTTON_BEFORE_MANIFEST', '../fixture-manifest.json'),
                ('MINION_BUTTON_AFTER_MANIFEST', '/tmp/fixture-manifest.json'),
                ('MINION_BUTTON_AFTER_MANIFEST', 'missing/fixture-manifest.json'),
            ]
            for key, value in cases:
                with self.subTest(key=key, value=value), patch.dict(os.environ, {**environment, key: value}):
                    before = len(calls)
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        runpy.run_path(str(SCRIPT), init_globals={'new_tab': browser_start})
                    self.assertEqual(len(calls), before)
            (root / 'fresh-proof.json').write_text('retained evidence')
            with patch.dict(os.environ, environment):
                with self.assertRaisesRegex(ValueError, 'must be fresh'):
                    runpy.run_path(str(SCRIPT), init_globals={'new_tab': browser_start})
            self.assertEqual((root / 'fresh-proof.json').read_text(), 'retained evidence')

if __name__ == '__main__':
    main()

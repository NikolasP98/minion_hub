#!/usr/bin/env python3
import json, os, re, stat, sys, tarfile, unicodedata

def fail(code):
    raise SystemExit(code)

def normalized(name):
    if not name or name.startswith('/') or '\\' in name: fail('archive_path')
    if name.startswith('./'): name = name[2:]
    clean = os.path.normpath(name)
    if clean in ('.', '..') or clean.startswith('../') or clean != name.rstrip('/'): fail('archive_path')
    return clean

def inspect(archive):
    seen = set(); result = []
    with tarfile.open(archive, 'r:*') as source:
        for item in source.getmembers():
            if item.name in ('.', './') and item.isdir(): continue
            name = normalized(item.name)
            if any(part in ('.env', '.env.local', 'worker.env') for part in name.split('/')):
                fail('archive_secret_path')
            folded = unicodedata.normalize('NFC', name).casefold()
            if folded in seen: fail('archive_duplicate')
            seen.add(folded)
            if not (item.isfile() or item.isdir()): fail('archive_type')
            if item.mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX | stat.S_IWGRP | stat.S_IWOTH): fail('archive_mode')
            if item.uid != 0 or item.gid != 0: fail('archive_owner')
            if item.pax_headers: fail('archive_xattr')
            if item.isfile() and item.size <= 1024 * 1024:
                stream = source.extractfile(item)
                content = stream.read() if stream else b''
                if b'MINION_ARTIFACT_CUSTOMER_CANARY_DO_NOT_PACKAGE' in content:
                    fail('archive_customer_canary')
                if not name.startswith('node_modules/') and re.search(
                    rb'https?://[^\s/:]+:[^@\s/]+@', content
                ):
                    fail('archive_url_credentials')
            result.append({'path': name, 'type': 'file' if item.isfile() else 'dir', 'size': item.size})
    return result

def extract(archive, destination):
    inventory = inspect(archive)
    root = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with tarfile.open(archive, 'r:*') as source:
            members = {normalized(x.name): x for x in source.getmembers()
                       if x.name not in ('.', './')}
            hook = os.environ.get('WORKER_EXTRACT_TEST_HOOK')
            if hook:
                if os.environ.get('MINION_ARTIFACT_TEST') != '1': fail('extract_test_hook_forbidden')
                open(hook + '.ready', 'x').close()
                for _ in range(500):
                    if os.path.exists(hook + '.continue'): break
                    import time; time.sleep(0.01)
                else: fail('extract_test_hook_timeout')
            for entry in inventory:
                parts = entry['path'].split('/')
                parent = os.dup(root)
                try:
                    for part in parts[:-1]:
                        try: os.mkdir(part, 0o755, dir_fd=parent)
                        except FileExistsError: pass
                        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                        os.close(parent); parent = child
                    leaf = parts[-1]
                    if entry['type'] == 'dir':
                        try: os.mkdir(leaf, 0o755, dir_fd=parent)
                        except FileExistsError: pass
                    else:
                        mode = members[entry['path']].mode & 0o555
                        fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
                        try:
                            stream = source.extractfile(members[entry['path']])
                            if stream is None: fail('archive_stream')
                            while chunk := stream.read(1024 * 1024):
                                view = memoryview(chunk)
                                while view:
                                    written = os.write(fd, view)
                                    if written <= 0: fail('archive_write')
                                    view = view[written:]
                        finally: os.close(fd)
                finally: os.close(parent)
        actual = []
        for base, directories, files in os.walk(destination, followlinks=False):
            for name in directories + files:
                full = os.path.join(base, name)
                info = os.lstat(full)
                if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    fail('extracted_type')
                actual.append(os.path.relpath(full, destination))
        if sorted(actual) != sorted(entry['path'] for entry in inventory): fail('extracted_inventory')
    finally: os.close(root)

def strict_json(file):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value: fail('manifest_duplicate_key')
            value[key] = item
        return value
    with open(file, encoding='utf-8') as source:
        return json.load(source, object_pairs_hook=pairs)

if len(sys.argv) != 3 or sys.argv[1] not in ('inspect', 'extract', 'strict-json'): fail('usage')
if sys.argv[1] == 'strict-json':
    print(json.dumps(strict_json(sys.argv[2]), separators=(',', ':')))
    raise SystemExit(0)
items = inspect(sys.argv[2])
if sys.argv[1] == 'inspect': print(json.dumps(items, separators=(',', ':')))
else:
    destination = os.environ.get('WORKER_EXTRACT_ROOT')
    if not destination: fail('extract_root')
    extract(sys.argv[2], destination)

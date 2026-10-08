# Decrypt many packages, skipping the ones the key can't open: decrypt_many.py KEYFILE OUTDIR LISTFILE
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts'))
from upk import decrypt_package  # noqa: E402
key = open(sys.argv[1], 'rb').read(); outdir = sys.argv[2]
ok = fail = 0
for path in open(sys.argv[3]).read().splitlines():
    try:
        data, s, chunks = decrypt_package(open(path, 'rb').read(), key)
        open(os.path.join(outdir, os.path.basename(path)), 'wb').write(data); ok += 1
    except Exception:
        fail += 1
print('decrypted', ok, 'failed', fail)

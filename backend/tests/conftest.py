import os

# Tests never touch the on-disk provider cache.
os.environ["TESSERA_NO_DISK_CACHE"] = "1"

"""Reorganize R2 media object keys into an observable business structure.

Read-only classification + a safe copy-then-update migration. See __main__.py
for the CLI. This package never deletes an object unless ``--cleanup-old`` is
explicitly passed (and even then only after a successful verify).
"""

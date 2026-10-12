# Database migrations

Run from `apps/api` after PostgreSQL is healthy:

```powershell
python -m alembic upgrade head
python -m app.seed
```

Use `python -m alembic revision --autogenerate -m "description"` for every schema change after the baseline. Do not use `--reset` against a database containing real operational data.

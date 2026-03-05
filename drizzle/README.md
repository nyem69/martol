# Migration Guidelines

- Always create rollback scripts for destructive migrations
- Never add NOT NULL columns without a DEFAULT to populated tables
- Add nullable first, backfill data, then add NOT NULL constraint
- Use `ALTER TABLE ... ADD CONSTRAINT` for new CHECK constraints
- Run all migrations in staging before production
- Review generated SQL before applying — drizzle-kit output should be audited

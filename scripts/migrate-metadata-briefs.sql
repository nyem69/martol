-- One-time data migration: copy briefs from organization.metadata JSON
-- into the project_brief table for all orgs that have a brief set.
--
-- Safe to run multiple times — skips orgs that already have an active brief.
-- Run with: psql "$DATABASE_URL" -f scripts/migrate-metadata-briefs.sql

INSERT INTO project_brief (org_id, content, version, status, created_by, created_at)
SELECT
    o.id,
    (o.metadata::json->>'brief'),
    1,
    'active',
    -- Attribute to the org owner (first owner member)
    (SELECT m."userId" FROM member m WHERE m."organizationId" = o.id AND m.role = 'owner' LIMIT 1),
    NOW()
FROM organization o
WHERE o.metadata IS NOT NULL
  AND o.metadata != ''
  AND (o.metadata::json->>'brief') IS NOT NULL
  AND LENGTH(o.metadata::json->>'brief') > 0
  -- Skip orgs that already have an active brief in the table
  AND NOT EXISTS (
      SELECT 1 FROM project_brief pb WHERE pb.org_id = o.id AND pb.status = 'active'
  );

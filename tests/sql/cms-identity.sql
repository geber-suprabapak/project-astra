-- Run only in an isolated test database after 0003_cms_identity.sql.
-- Assertions exercise the actual PostgreSQL constraints/trigger; fixtures roll back.
BEGIN;

INSERT INTO cms.profiles (id, logto_subject, role)
VALUES ('b1000000-0000-4000-8000-000000000001', 'synthetic-cms-schema-check', 'siswa');

DO $$
DECLARE
  profile cms.profiles;
  cutoff timestamptz;
  rejected boolean;
BEGIN
  SELECT * INTO STRICT profile FROM cms.profiles
  WHERE logto_subject = 'synthetic-cms-schema-check';
  ASSERT profile.access_enabled = false, 'Import must not enable access by default';
  ASSERT profile.authz_version = 1 AND profile.session_valid_after IS NULL;

  UPDATE cms.profiles SET full_name = 'Synthetic User'
  WHERE id = profile.id RETURNING * INTO profile;
  ASSERT profile.authz_version = 1 AND profile.session_valid_after IS NULL,
    'Display changes must not change authority';

  UPDATE cms.profiles SET access_enabled = true
  WHERE id = profile.id RETURNING * INTO profile;
  ASSERT profile.authz_version = 2 AND profile.session_valid_after IS NOT NULL,
    'Enabling access must revoke earlier tokens';
  cutoff := profile.session_valid_after;

  UPDATE cms.profiles SET role = 'admin_jurusan',
    jurusan_id = 'b1000000-0000-4000-8000-000000000002', jurusan_slug = 'pplg'
  WHERE id = profile.id RETURNING * INTO profile;
  ASSERT profile.authz_version = 3 AND profile.session_valid_after >= cutoff,
    'Role/scope updates must increment authority and revoke earlier tokens';
  cutoff := profile.session_valid_after;

  UPDATE cms.profiles SET authz_version = 1, session_valid_after = '2000-01-01Z'
  WHERE id = profile.id RETURNING * INTO profile;
  ASSERT profile.authz_version = 3 AND profile.session_valid_after = cutoff,
    'Authority version and session cutoff must not go backwards';

  UPDATE cms.profiles SET logto_subject = 'synthetic-cms-rebound'
  WHERE id = profile.id RETURNING * INTO profile;
  ASSERT profile.authz_version = 4 AND profile.session_valid_after >= cutoff,
    'Rebinding identity must revoke previous sessions';

  rejected := false;
  BEGIN
    INSERT INTO cms.profiles (id, logto_subject, role)
    VALUES ('b1000000-0000-4000-8000-000000000003', profile.logto_subject, 'siswa');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'A Logto identity must not bind multiple CMS profiles';

  rejected := false;
  BEGIN
    UPDATE cms.profiles SET role = 'platform_admin' WHERE id = profile.id;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'Mobile/attendance roles must not grant CMS authority';

  rejected := false;
  BEGIN
    UPDATE cms.profiles SET id = 'b1000000-0000-4000-8000-000000000004'
    WHERE id = profile.id;
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  ASSERT rejected, 'Legacy UUID ownership must be stable';
END;
$$;

ROLLBACK;

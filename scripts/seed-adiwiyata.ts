import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (process.env.NODE_ENV !== 'development' || !databaseUrl) {
  throw new Error('Adiwiyata demo seed requires NODE_ENV=development and DATABASE_URL.')
}

const databaseHost = new URL(databaseUrl).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('Adiwiyata demo seed only accepts a loopback PostgreSQL host.')
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  const periods = await sql<{ id: string; school_id: string | null }[]>`
    SELECT id, school_id FROM academic_periods WHERE is_active = true
  `
  if (periods.length !== 1 || !periods[0]?.school_id) {
    throw new Error('Demo seed requires exactly one active Academic Period with a school.')
  }
  const period = periods[0]

  const reporters = await sql<{ user_id: string; class_id: string }[]>`
    SELECT p.user_id, ce.class_id
    FROM profiles p
    JOIN class_enrollments ce ON ce.user_id = p.user_id
    JOIN classes c ON c.id = ce.class_id
    WHERE p.role = 'student'
      AND p.lifecycle_status = 'approved'
      AND ce.status = 'active'
      AND ce.academic_period_id = ${period.id}::uuid
      AND c.school_id = ${period.school_id}::uuid
      AND c.academic_period_id = ce.academic_period_id
      AND EXISTS (
        SELECT 1 FROM schedules s
        WHERE s.school_id = ${period.school_id}::uuid
          AND s.academic_period_id = ce.academic_period_id
          AND s.is_active = true
          AND (s.class_id = ce.class_id OR s.class_id IS NULL)
      )
    GROUP BY p.user_id, ce.class_id
    HAVING COUNT(*) = 1
    ORDER BY p.user_id
    LIMIT 1
  `
  if (!reporters[0]) {
    throw new Error(
      'Demo seed requires an approved Student fixture with one active scheduled Enrollment.',
    )
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO adiwiyata_sites (id, school_id, name, category, class_id, sort_order, created_by)
      VALUES
        ('d2000000-0000-0000-0000-000000000001', ${period.school_id}::uuid, 'Kebun Kelas Demo', 'tanaman', ${reporters[0]!.class_id}::uuid, 1, 'dev-seed'),
        ('d2000000-0000-0000-0000-000000000002', ${period.school_id}::uuid, 'Kolam Lele Galon Demo', 'lele', NULL, 2, 'dev-seed')
      ON CONFLICT (id) DO UPDATE SET
        school_id = EXCLUDED.school_id,
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        class_id = EXCLUDED.class_id,
        is_active = true,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `
    await tx`
      INSERT INTO adiwiyata_eligibility (user_id, added_by, is_active)
      VALUES (${reporters[0]!.user_id}, 'dev-seed', true)
      ON CONFLICT (user_id) DO UPDATE SET is_active = true, updated_at = NOW()
    `
  })
  console.log('Seeded two development Sites and one eligible Student fixture.')
} finally {
  await sql.end()
}

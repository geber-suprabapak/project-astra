-- Additive source-only CMS tables. No seed, import, account or existing domain mutation.
-- Apply only after reviewing the actual target and recovery plan.
-- Rollback retains the tables/data; restore the previous compatible application image.
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '10min';
BEGIN;

CREATE TABLE IF NOT EXISTS cms.guru_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, role TEXT, image TEXT, nip TEXT,
    email TEXT, phone TEXT,
    category TEXT DEFAULT 'Guru',
    jurusan TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, short_name TEXT NOT NULL, description TEXT,
    image TEXT, icon TEXT DEFAULT 'GraduationCap',
    highlights JSONB DEFAULT '[]',
    careers JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms.agenda (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, date TEXT NOT NULL,
    time TEXT, location TEXT, category TEXT DEFAULT 'Umum',
    image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.akreditasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, issuer TEXT, year TEXT, grade TEXT,
    description TEXT, document_url TEXT, image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.alumni_inspiratif (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, graduation_year TEXT NOT NULL,
    achievement TEXT NOT NULL, photo TEXT, company TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.bank_soal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, file_url TEXT,
    subject TEXT,
    jurusan TEXT,
    mapel TEXT,
    tipe TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.beasiswa (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, provider TEXT, description TEXT, requirements TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.berita (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    excerpt TEXT, content TEXT, image TEXT,
    category TEXT DEFAULT 'Umum',
    author TEXT DEFAULT 'Redaksi SMKN 2 Magelang',
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT
);

CREATE TABLE IF NOT EXISTS cms.bkk_lowongan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, company TEXT NOT NULL, location TEXT,
    type TEXT, deadline TEXT, description TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.download_dokumen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, type TEXT DEFAULT 'PDF', size TEXT,
    file_url TEXT NOT NULL, category TEXT DEFAULT 'Umum',
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.ekstrakurikuler (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, category TEXT DEFAULT 'Umum',
    description TEXT, image TEXT, pembina TEXT, schedule TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.fasilitas_praktik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
    image TEXT, capacity TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.galeri (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, image TEXT NOT NULL,
    category TEXT DEFAULT 'Gambar', date TEXT, description TEXT,
    jurusan TEXT,        
    media_type TEXT DEFAULT 'gambar',
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.guru_produktif (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, title TEXT,
    photo TEXT, subjects TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.guru_tamu (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, company TEXT NOT NULL, topic TEXT, date TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.hero_slides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, subtitle TEXT, image TEXT NOT NULL,
    cta_label TEXT, cta_href TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT
);

CREATE TABLE IF NOT EXISTS cms.jadwal_pelajaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "jurusan" TEXT,
  "kelas" TEXT,
  "day" TEXT,
  "time_start" TEXT,
  "time_end" TEXT,
  "subject" TEXT,
  "teacher" TEXT,
  "room" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jadwal_ujian (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, date TEXT NOT NULL, time TEXT,
    duration TEXT, room TEXT, category TEXT DEFAULT 'Umum',
    type TEXT DEFAULT 'Sumatif',
    date_start TEXT,
    date_end TEXT,
    kelas TEXT,
    file_url TEXT,
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan_berita (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    image TEXT, tag TEXT DEFAULT 'Kegiatan', date TEXT NOT NULL,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan_produk (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    image TEXT, tech TEXT, made_by TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kalender_akademik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    month TEXT NOT NULL, year_label TEXT NOT NULL,
    events JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.keunggulan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, icon TEXT, image TEXT,
    stat TEXT, href TEXT, category TEXT DEFAULT 'card'
              CHECK (category = ANY (ARRAY['card', 'highlight'])),
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.keunggulan_sekolah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    badge TEXT,
    icon TEXT DEFAULT 'Star',
    color TEXT DEFAULT 'blue',
    href TEXT,
    highlights JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kkm (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, mapel TEXT NOT NULL, kkm TEXT NOT NULL,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "subject" TEXT,
  "grade_level" TEXT,
  "kkm_value" NUMERIC,
  "year" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kriteria_kelulusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "description" TEXT,
  "points" JSONB,
  "year_academic" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kurikulum (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.layanan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, label TEXT, description TEXT, href TEXT NOT NULL,
    image TEXT, image_position TEXT DEFAULT '50% 50%',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.lsp (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  image TEXT,
  document_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.materi_pembelajaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, file_url TEXT,
    subject TEXT,
    jurusan TEXT,
    kelas TEXT,
    mapel TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mitra_dudi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, logo TEXT, category TEXT DEFAULT 'Umum',
    description TEXT, website TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mitra_industri_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, logo TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mou_kerjasama (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    partner TEXT NOT NULL, scope TEXT, year TEXT NOT NULL,
    document_url TEXT, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.organisasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'organisasi',
    image TEXT, ketua TEXT, pembina TEXT,
    "order" INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  "sort_order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.poin_pelanggaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, poin INTEGER DEFAULT 0,
    violation TEXT,
    points INTEGER DEFAULT 5,
    category TEXT DEFAULT 'Ringan',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.prestasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    level TEXT DEFAULT 'Sekolah',
    year TEXT NOT NULL, category TEXT DEFAULT 'Akademik',
    description TEXT, image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.prestasi_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL,
    level TEXT DEFAULT 'Sekolah', year TEXT NOT NULL,
    category TEXT DEFAULT 'Akademik', description TEXT, image TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sarpras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, image TEXT, capacity TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.school_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_name TEXT DEFAULT 'SMKN 2 Magelang',
    school_tagline TEXT DEFAULT 'SMK Pusat Keunggulan',
    npsn TEXT, nss TEXT,
    principal_name TEXT DEFAULT 'Kepala Sekolah',
    principal_title TEXT DEFAULT 'Kepala SMKN 2 Magelang',
    principal_photo TEXT, principal_greeting TEXT,
    principal_greeting_title TEXT DEFAULT 'Membangun Generasi Unggul & Berkarakter',
    address TEXT DEFAULT 'Jl. Jend. A. Yani No. 135A, Magelang, Jawa Tengah 56111',
    phone TEXT DEFAULT '(0293) 362-137',
    email TEXT DEFAULT 'info@smkn2magelang.sch.id',
    whatsapp TEXT,
    operating_hours TEXT DEFAULT 'Senin – Sabtu, 07:00 – 15:00 WIB',
    maps_embed_url TEXT, maps_link TEXT DEFAULT 'https://maps.google.com',
    instagram_url TEXT, youtube_url TEXT, facebook_url TEXT, tiktok_url TEXT,
    stat_founded TEXT DEFAULT '1965', stat_students TEXT DEFAULT '1.200+',
    stat_teachers TEXT DEFAULT '85', stat_programs TEXT DEFAULT '4',
    stat_graduation_rate TEXT DEFAULT '100%', stat_dudi_partners TEXT DEFAULT '50+',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.school_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    label TEXT NOT NULL, value TEXT NOT NULL, suffix TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sejarah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    year TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sertifikasi_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_biaya (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item TEXT NOT NULL, amount TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_faq (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    question TEXT NOT NULL, answer TEXT NOT NULL,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_jadwal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, date TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_pengumuman (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, content TEXT, file_url TEXT, date TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_persyaratan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    text TEXT NOT NULL, sort_order INTEGER DEFAULT 1,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT DEFAULT 'Penerimaan Peserta Didik Baru',
    description TEXT,
    tahun_ajaran TEXT DEFAULT '',
    tanggal_buka TEXT,
    tanggal_tutup TEXT,
    kuota TEXT,
    form_url TEXT, upload_url TEXT,
    form_description TEXT,
    berkas_description TEXT,
    contact_name TEXT, contact_phone TEXT, contact_email TEXT,
    contact_whatsapp TEXT,
    contact_address TEXT,
    pengumuman_link TEXT,
    pengumuman_description TEXT,
    pengumuman_date TEXT,
    registration_open BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    step INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
    description TEXT, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.struktur_organisasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, role TEXT NOT NULL, abbr TEXT, image TEXT,
    category TEXT DEFAULT 'wakil_kepala',
    "order" INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "guru_staff_id" UUID REFERENCES cms.guru_staff(id) ON DELETE SET NULL,
  "sort_order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tata_tertib (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.teaching_factory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
    image TEXT, products TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.testimoni_dudi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, company TEXT NOT NULL, position TEXT,
    quote TEXT NOT NULL, sort_order INTEGER DEFAULT 1,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tracer_alumni (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    year TEXT NOT NULL, employed_percent TEXT NOT NULL,
    college_percent TEXT NOT NULL, entrepreneur_percent TEXT NOT NULL,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tujuan_sekolah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.ukk (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "jurusan" TEXT,
  "year" TEXT,
  "scheme" TEXT,
  "description" TEXT,
  "schedule" TEXT,
  "requirements" TEXT,
  "file_url" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.visi_misi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    visi TEXT, misi JSONB DEFAULT '[]', tujuan JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_akademik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "file_url" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_hubin (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "image" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_kesiswaan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "image" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.modul_ajar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, category text NOT NULL,
  jurusan text NOT NULL, subject text NOT NULL, kelas text, description text, file_url text,
  sort_order integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms.pkl_alur_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step integer NOT NULL CHECK (step > 0),
  title text NOT NULL, description text, sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON cms.modul_ajar, cms.pkl_alur_steps FROM PUBLIC;

CREATE TABLE IF NOT EXISTS cms.content_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES cms.profiles(id),
  actor_name text,
  actor_role text NOT NULL,
  resource text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON cms.guru_staff FROM PUBLIC;
REVOKE ALL ON cms.jurusan FROM PUBLIC;
REVOKE ALL ON cms.agenda FROM PUBLIC;
REVOKE ALL ON cms.akreditasi FROM PUBLIC;
REVOKE ALL ON cms.alumni_inspiratif FROM PUBLIC;
REVOKE ALL ON cms.bank_soal FROM PUBLIC;
REVOKE ALL ON cms.beasiswa FROM PUBLIC;
REVOKE ALL ON cms.berita FROM PUBLIC;
REVOKE ALL ON cms.bkk_lowongan FROM PUBLIC;
REVOKE ALL ON cms.download_dokumen FROM PUBLIC;
REVOKE ALL ON cms.ekstrakurikuler FROM PUBLIC;
REVOKE ALL ON cms.fasilitas_praktik FROM PUBLIC;
REVOKE ALL ON cms.galeri FROM PUBLIC;
REVOKE ALL ON cms.guru_produktif FROM PUBLIC;
REVOKE ALL ON cms.guru_tamu FROM PUBLIC;
REVOKE ALL ON cms.hero_slides FROM PUBLIC;
REVOKE ALL ON cms.jadwal_pelajaran FROM PUBLIC;
REVOKE ALL ON cms.jadwal_ujian FROM PUBLIC;
REVOKE ALL ON cms.jurusan_berita FROM PUBLIC;
REVOKE ALL ON cms.jurusan_produk FROM PUBLIC;
REVOKE ALL ON cms.kalender_akademik FROM PUBLIC;
REVOKE ALL ON cms.keunggulan FROM PUBLIC;
REVOKE ALL ON cms.keunggulan_sekolah FROM PUBLIC;
REVOKE ALL ON cms.kkm FROM PUBLIC;
REVOKE ALL ON cms.kriteria_kelulusan FROM PUBLIC;
REVOKE ALL ON cms.kurikulum FROM PUBLIC;
REVOKE ALL ON cms.layanan FROM PUBLIC;
REVOKE ALL ON cms.lsp FROM PUBLIC;
REVOKE ALL ON cms.materi_pembelajaran FROM PUBLIC;
REVOKE ALL ON cms.mitra_dudi FROM PUBLIC;
REVOKE ALL ON cms.mitra_industri_jurusan FROM PUBLIC;
REVOKE ALL ON cms.mou_kerjasama FROM PUBLIC;
REVOKE ALL ON cms.organisasi FROM PUBLIC;
REVOKE ALL ON cms.poin_pelanggaran FROM PUBLIC;
REVOKE ALL ON cms.prestasi FROM PUBLIC;
REVOKE ALL ON cms.prestasi_jurusan FROM PUBLIC;
REVOKE ALL ON cms.sarpras FROM PUBLIC;
REVOKE ALL ON cms.school_info FROM PUBLIC;
REVOKE ALL ON cms.school_stats FROM PUBLIC;
REVOKE ALL ON cms.sejarah FROM PUBLIC;
REVOKE ALL ON cms.sertifikasi_jurusan FROM PUBLIC;
REVOKE ALL ON cms.spmb_biaya FROM PUBLIC;
REVOKE ALL ON cms.spmb_faq FROM PUBLIC;
REVOKE ALL ON cms.spmb_jadwal FROM PUBLIC;
REVOKE ALL ON cms.spmb_pengumuman FROM PUBLIC;
REVOKE ALL ON cms.spmb_persyaratan FROM PUBLIC;
REVOKE ALL ON cms.spmb_settings FROM PUBLIC;
REVOKE ALL ON cms.spmb_timeline FROM PUBLIC;
REVOKE ALL ON cms.struktur_organisasi FROM PUBLIC;
REVOKE ALL ON cms.tata_tertib FROM PUBLIC;
REVOKE ALL ON cms.teaching_factory FROM PUBLIC;
REVOKE ALL ON cms.testimoni_dudi FROM PUBLIC;
REVOKE ALL ON cms.tracer_alumni FROM PUBLIC;
REVOKE ALL ON cms.tujuan_sekolah FROM PUBLIC;
REVOKE ALL ON cms.ukk FROM PUBLIC;
REVOKE ALL ON cms.visi_misi FROM PUBLIC;
REVOKE ALL ON cms.waka_akademik FROM PUBLIC;
REVOKE ALL ON cms.waka_hubin FROM PUBLIC;
REVOKE ALL ON cms.waka_kesiswaan FROM PUBLIC;
REVOKE ALL ON cms.content_audit FROM PUBLIC;


-- Existing admin form variants share these CMS resources.
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS amount text;
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS deadline text;
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS requirements text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS salary text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS event_date text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS partner_name text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS mou_number text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS signed_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS expired_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS mou_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS valid_until text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE cms.spmb_biaya ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE cms.tata_tertib ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS rating integer;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS jurusan text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS company_or_campus text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS salary_range text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS graduation_year integer;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE cms.tracer_alumni ALTER COLUMN year DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN employed_percent DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN college_percent DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN entrepreneur_percent DROP NOT NULL;
ALTER TABLE cms.mou_kerjasama ALTER COLUMN partner DROP NOT NULL;
ALTER TABLE cms.mou_kerjasama ALTER COLUMN year DROP NOT NULL;
ALTER TABLE cms.download_dokumen ALTER COLUMN name DROP NOT NULL;
ALTER TABLE cms.testimoni_dudi ALTER COLUMN quote DROP NOT NULL;
ALTER TABLE cms.testimoni_dudi ALTER COLUMN company DROP NOT NULL;
ALTER TABLE cms.poin_pelanggaran ALTER COLUMN title DROP NOT NULL;

CREATE TABLE IF NOT EXISTS cms.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, type text NOT NULL DEFAULT 'PDF', size text, file_url text NOT NULL,
  category text NOT NULL DEFAULT 'Umum', sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE cms.documents FROM PUBLIC;

COMMIT;

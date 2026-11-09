-- ============================================================================
-- ADUN Attendance System - Direct Supabase Access & Full Data Seed
-- Migration Name: 20261109000000_supabase_full_seed_and_permissions.sql
-- Description:
--   1. Enables direct client & RPC access for Admin Portal and Student PWA.
--   2. Seeds mandatory settings and default accounts (Admin and Lecturer Mr Tega).
--   3. Seeds course ADUN CYB 201.
--   4. Seeds all 93 200L Computer Science students into students_master.
--   5. Enrolls all 93 students into the course_roster for ADUN CYB 201.
-- ============================================================================

-- STEP 1: ENABLE FULL ACCESS FOR ANON AND AUTHENTICATED ROLES
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS students_master DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS course_roster DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lecture_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_attempts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS device_bindings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS device_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settings DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

-- STEP 2: SEED INSTITUTIONAL SETTINGS
INSERT INTO settings (
    id,
    location_mode,
    campus_boundary_geojson,
    location_accuracy_threshold_m,
    default_session_duration_minutes,
    max_session_duration_minutes,
    selfie_retention_days,
    grace_minutes,
    max_active_courses_per_lecturer,
    rate_limit_token_per_minute,
    rate_limit_matric_per_minute
) VALUES (
    1,
    'evidence_only',
    NULL,
    50.0,
    60,
    180,
    180,
    10,
    9,
    60,
    30
) ON CONFLICT (id) DO NOTHING;

-- STEP 3: SEED ADMIN AND LECTURER ACCOUNTS
-- Seed Admin (username: admin, password: admin)
INSERT INTO users (
    id,
    role,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    created_at
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    'admin',
    'admin@adun.edu.ng',
    crypt('admin', gen_salt('bf', 10)),
    'active',
    true,
    timezone('utc', now())
) ON CONFLICT (username) DO UPDATE SET
    status = 'active',
    role = 'admin';

-- Seed Lecturer Mr Tega (username: tega, password: admin)
INSERT INTO users (
    id,
    role,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    created_at
) VALUES (
    '00000000-0000-0000-0000-000000000002'::uuid,
    'lecturer',
    'tega',
    'tega@adun.edu.ng',
    crypt('admin', gen_salt('bf', 10)),
    'active',
    false,
    timezone('utc', now())
) ON CONFLICT (username) DO UPDATE SET
    status = 'active',
    role = 'lecturer';

-- STEP 4: SEED COURSE ADUN CYB 201
INSERT INTO courses (
    id,
    code,
    title,
    lecturer_id,
    status,
    created_at
) VALUES (
    '00000000-0000-0000-0000-000000000101'::uuid,
    'ADUN CYB 201',
    'Introduction to Cybersecurity',
    '00000000-0000-0000-0000-000000000002'::uuid,
    'active',
    timezone('utc', now())
) ON CONFLICT (id) DO NOTHING;

-- STEP 5: SEED ALL 93 200L COMPUTER SCIENCE STUDENTS INTO students_master
INSERT INTO students_master (id, matric_no, search_key, surname, first_name, middle_name, program, level, email, phone, status, created_at)
VALUES
  ('00000000-0000-0000-0001-000000000001'::uuid, 'ADUN/FS/COM/25/001', 'nwomonoh shadrach okwuchukwu adun/fs/com/25/001', 'NWOMONOH', 'SHADRACH', 'OKWUCHUKWU', 'Computer Science', 200, 'nwomonoh.shadrach@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000002'::uuid, 'ADUN/FS/COM/25/002', 'reuben jeffery nwadibie adun/fs/com/25/002', 'REUBEN', 'JEFFERY', 'NWADIBIE', 'Computer Science', 200, 'reuben.jeffery@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000003'::uuid, 'ADUN/FS/COM/25/003', 'brown elvis  adun/fs/com/25/003', 'BROWN', 'ELVIS', NULL, 'Computer Science', 200, 'brown.elvis@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000004'::uuid, 'ADUN/FS/COM/25/004', 'egbua chimeka prince adun/fs/com/25/004', 'EGBUA', 'CHIMEKA', 'PRINCE', 'Computer Science', 200, 'egbua.chimeka@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000005'::uuid, 'ADUN/FS/COM/25/005', 'adiah chisom  adun/fs/com/25/005', 'ADIAH', 'CHISOM', NULL, 'Computer Science', 200, 'adiah.chisom@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000006'::uuid, 'ADUN/FS/COM/25/006', 'okitiakpe oghenetejiri  adun/fs/com/25/006', 'OKITIAKPE', 'OGHENETEJIRI', NULL, 'Computer Science', 200, 'okitiakpe.oghenetejiri@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000007'::uuid, 'ADUN/FS/COM/25/007', 'amaraeze emmanuel kamsiyochukwu adun/fs/com/25/007', 'AMARAEZE', 'EMMANUEL', 'KAMSIYOCHUKWU', 'Computer Science', 200, 'amaraeze.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000008'::uuid, 'ADUN/FS/COM/25/008', 'okonji ebelechukwu jaina adun/fs/com/25/008', 'OKONJI', 'EBELECHUKWU', 'JAINA', 'Computer Science', 200, 'okonji.ebelechukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000009'::uuid, 'ADUN/FS/COM/25/009', 'ogude olise michael adun/fs/com/25/009', 'OGUDE', 'OLISE', 'MICHAEL', 'Computer Science', 200, 'ogude.olise@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000010'::uuid, 'ADUN/FS/COM/25/010', 'oladipo oluwakemi orevaoghene adun/fs/com/25/010', 'OLADIPO', 'OLUWAKEMI', 'OREVAOGHENE', 'Computer Science', 200, 'oladipo.oluwakemi@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000011'::uuid, 'ADUN/FS/COM/25/011', 'sodade amos olusola adun/fs/com/25/011', 'SODADE', 'AMOS', 'OLUSOLA', 'Computer Science', 200, 'sodade.amos@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000012'::uuid, 'ADUN/FS/COM/25/012', 'nwajei evans chukwuemeka adun/fs/com/25/012', 'NWAJEI', 'EVANS', 'CHUKWUEMEKA', 'Computer Science', 200, 'nwajei.evans@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000013'::uuid, 'ADUN/FS/COM/25/013', 'oluchieze ifeoma joyce adun/fs/com/25/013', 'OLUCHIEZE', 'IFEOMA', 'JOYCE', 'Computer Science', 200, 'oluchieze.ifeoma@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000014'::uuid, 'ADUN/FS/COM/25/014', 'osagie goodness oghosa adun/fs/com/25/014', 'OSAGIE', 'GOODNESS', 'OGHOSA', 'Computer Science', 200, 'osagie.goodness@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000015'::uuid, 'ADUN/FS/COM/25/015', 'amechi godswill dabelechukwu adun/fs/com/25/015', 'AMECHI', 'GODSWILL', 'DABELECHUKWU', 'Computer Science', 200, 'amechi.godswill@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000016'::uuid, 'ADUN/FS/COM/25/016', 'otaigbe ehireme carmelo adun/fs/com/25/016', 'OTAIGBE', 'EHIREME', 'CARMELO', 'Computer Science', 200, 'otaigbe.ehireme@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000017'::uuid, 'ADUN/FS/COM/25/017', 'egunatum chukwuka david adun/fs/com/25/017', 'EGUNATUM', 'CHUKWUKA', 'DAVID', 'Computer Science', 200, 'egunatum.chukwuka@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000018'::uuid, 'ADUN/FS/COM/25/018', 'jire oghenekaro kenneth adun/fs/com/25/018', 'JIRE', 'OGHENEKARO', 'KENNETH', 'Computer Science', 200, 'jire.oghenekaro@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000019'::uuid, 'ADUN/FS/COM/25/019', 'chuba kenneth kamsi adun/fs/com/25/019', 'CHUBA', 'KENNETH', 'KAMSI', 'Computer Science', 200, 'chuba.kenneth@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000020'::uuid, 'ADUN/FS/COM/25/020', 'idoro elvina ogheneyerovwome adun/fs/com/25/020', 'IDORO', 'ELVINA', 'OGHENEYEROVWOME', 'Computer Science', 200, 'idoro.elvina@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000021'::uuid, 'ADUN/FS/COM/25/021', 'maduagwuna ugochukwu collins adun/fs/com/25/021', 'MADUAGWUNA', 'UGOCHUKWU', 'COLLINS', 'Computer Science', 200, 'maduagwuna.ugochukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000022'::uuid, 'ADUN/FS/COM/25/022', 'odiaka ogechukwu nnebuogor adun/fs/com/25/022', 'ODIAKA', 'OGECHUKWU', 'NNEBUOGOR', 'Computer Science', 200, 'odiaka.ogechukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000023'::uuid, 'ADUN/FS/COM/25/023', 'henry kelvin chukwuemeke adun/fs/com/25/023', 'HENRY', 'KELVIN', 'CHUKWUEMEKE', 'Computer Science', 200, 'henry.kelvin@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000024'::uuid, 'ADUN/FS/COM/25/024', 'edeni marvin godwin adun/fs/com/25/024', 'EDENI', 'MARVIN', 'GODWIN', 'Computer Science', 200, 'edeni.marvin@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000025'::uuid, 'ADUN/FS/COM/25/025', 'vincent angel oghenewegba adun/fs/com/25/025', 'VINCENT', 'ANGEL', 'OGHENEWEGBA', 'Computer Science', 200, 'vincent.angel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000026'::uuid, 'ADUN/FS/COM/25/026', 'holikins prince daniel adun/fs/com/25/026', 'HOLIKINS', 'PRINCE', 'DANIEL', 'Computer Science', 200, 'holikins.prince@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000027'::uuid, 'ADUN/FS/COM/25/027', 'mayuku-dore omashola richard adun/fs/com/25/027', 'MAYUKU-DORE', 'OMASHOLA', 'RICHARD', 'Computer Science', 200, 'mayukudore.omashola@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000028'::uuid, 'ADUN/FS/COM/25/028', 'tejiro emmanuel ebruvwyor adun/fs/com/25/028', 'TEJIRO', 'EMMANUEL', 'EBRUVWYOR', 'Computer Science', 200, 'tejiro.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000029'::uuid, 'ADUN/FS/COM/25/029', 'anwadike chukwufumnaya sophia adun/fs/com/25/029', 'ANWADIKE', 'CHUKWUFUMNAYA', 'SOPHIA', 'Computer Science', 200, 'anwadike.chukwufumnaya@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000030'::uuid, 'ADUN/FS/COM/25/030', 'emiko-edemi moyowa precious adun/fs/com/25/030', 'EMIKO-EDEMI', 'MOYOWA', 'PRECIOUS', 'Computer Science', 200, 'emikoedemi.moyowa@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000031'::uuid, 'ADUN/FS/COM/25/031', 'basil chinedu divine adun/fs/com/25/031', 'BASIL', 'CHINEDU', 'DIVINE', 'Computer Science', 200, 'basil.chinedu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000032'::uuid, 'ADUN/FS/COM/25/032', 'ohia ugochukwu  adun/fs/com/25/032', 'OHIA', 'UGOCHUKWU', NULL, 'Computer Science', 200, 'ohia.ugochukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000033'::uuid, 'ADUN/FS/COM/25/033', 'udewena kosisochukwu daniel adun/fs/com/25/033', 'UDEWENA', 'KOSISOCHUKWU', 'DANIEL', 'Computer Science', 200, 'udewena.kosisochukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000034'::uuid, 'ADUN/FS/COM/25/034', 'olannye ifechukwude isaac adun/fs/com/25/034', 'OLANNYE', 'IFECHUKWUDE', 'ISAAC', 'Computer Science', 200, 'olannye.ifechukwude@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000035'::uuid, 'ADUN/FS/COM/25/035', 'imaku kelvin imafidon adun/fs/com/25/035', 'IMAKU', 'KELVIN', 'IMAFIDON', 'Computer Science', 200, 'imaku.kelvin@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000036'::uuid, 'ADUN/FS/COM/25/036', 'nwachukwu samson  adun/fs/com/25/036', 'NWACHUKWU', 'SAMSON', NULL, 'Computer Science', 200, 'nwachukwu.samson@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000037'::uuid, 'ADUN/FS/COM/25/037', 'oyoko christabel ekojorde adun/fs/com/25/037', 'OYOKO', 'CHRISTABEL', 'EKOJORDE', 'Computer Science', 200, 'oyoko.christabel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000038'::uuid, 'ADUN/FS/COM/25/038', 'onipede miracle jestunimininu adun/fs/com/25/038', 'ONIPEDE', 'MIRACLE', 'JESTUNIMININU', 'Computer Science', 200, 'onipede.miracle@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000039'::uuid, 'ADUN/FS/COM/25/039', 'chris-ugbogu obim george adun/fs/com/25/039', 'CHRIS-UGBOGU', 'OBIM', 'GEORGE', 'Computer Science', 200, 'chrisugbogu.obim@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000040'::uuid, 'ADUN/FS/COM/25/040', 'udeh mercy onyinyechi adun/fs/com/25/040', 'UDEH', 'MERCY', 'ONYINYECHI', 'Computer Science', 200, 'udeh.mercy@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000041'::uuid, 'ADUN/FS/COM/25/041', 'jack emmanuel  adun/fs/com/25/041', 'JACK', 'EMMANUEL', NULL, 'Computer Science', 200, 'jack.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000042'::uuid, 'ADUN/FS/COM/25/042', 'anii- ogbuiyi chinecherem esther adun/fs/com/25/042', 'ANII- OGBUIYI', 'CHINECHEREM', 'ESTHER', 'Computer Science', 200, 'aniiogbuiyi.chinecherem@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000043'::uuid, 'ADUN/FS/COM/25/043', 'mbara awesome munachimso adun/fs/com/25/043', 'MBARA', 'AWESOME', 'MUNACHIMSO', 'Computer Science', 200, 'mbara.awesome@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000044'::uuid, 'ADUN/FS/COM/25/044', 'otu eseoghene emmanuel adun/fs/com/25/044', 'OTU', 'ESEOGHENE', 'EMMANUEL', 'Computer Science', 200, 'otu.eseoghene@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000045'::uuid, 'ADUN/FS/COM/25/045', 'ugochukwu victor chinedu adun/fs/com/25/045', 'UGOCHUKWU', 'VICTOR', 'CHINEDU', 'Computer Science', 200, 'ugochukwu.victor@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000046'::uuid, 'ADUN/FS/COM/25/046', 'jumbo daniel chikaodi adun/fs/com/25/046', 'JUMBO', 'DANIEL', 'CHIKAODI', 'Computer Science', 200, 'jumbo.daniel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000047'::uuid, 'ADUN/FS/COM/25/047', 'olaneje ohaneje ugochukwu adun/fs/com/25/047', 'OLANEJE', 'OHANEJE', 'UGOCHUKWU', 'Computer Science', 200, 'olaneje.ohaneje@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000048'::uuid, 'ADUN/FS/COM/25/048', 'egbregba orevaoghene hillary adun/fs/com/25/048', 'EGBREGBA', 'OREVAOGHENE', 'HILLARY', 'Computer Science', 200, 'egbregba.orevaoghene@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000049'::uuid, 'ADUN/FS/COM/25/049', 'obiosa gerald ugochukwu adun/fs/com/25/049', 'OBIOSA', 'GERALD', 'UGOCHUKWU', 'Computer Science', 200, 'obiosa.gerald@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000050'::uuid, 'ADUN/FS/COM/25/050', 'ode michael  adun/fs/com/25/050', 'ODE', 'MICHAEL', NULL, 'Computer Science', 200, 'ode.michael@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000051'::uuid, 'ADUN/FS/COM/25/051', 'adeyemi ayobami adebisi adun/fs/com/25/051', 'ADEYEMI', 'AYOBAMI', 'ADEBISI', 'Computer Science', 200, 'adeyemi.ayobami@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000052'::uuid, 'ADUN/FS/COM/25/052', 'simon israel ujadoo adun/fs/com/25/052', 'SIMON', 'ISRAEL', 'UJADOO', 'Computer Science', 200, 'simon.israel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000053'::uuid, 'ADUN/FS/COM/25/053', 'ibelema emmanuel  adun/fs/com/25/053', 'IBELEMA', 'EMMANUEL', NULL, 'Computer Science', 200, 'ibelema.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000054'::uuid, 'ADUN/FS/COM/25/054', 'odudu akokobe johnpaul adun/fs/com/25/054', 'ODUDU', 'AKOKOBE', 'JOHNPAUL', 'Computer Science', 200, 'odudu.akokobe@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000055'::uuid, 'ADUN/FS/COM/25/055', 'osuya david maluabuchukwu adun/fs/com/25/055', 'OSUYA', 'DAVID', 'MALUABUCHUKWU', 'Computer Science', 200, 'osuya.david@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000056'::uuid, 'ADUN/FS/COM/25/056', 'anyaragbu eric tochukwu adun/fs/com/25/056', 'ANYARAGBU', 'ERIC', 'TOCHUKWU', 'Computer Science', 200, 'anyaragbu.eric@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000057'::uuid, 'ADUN/FS/COM/25/057', 'mubarak suleman aghumidua adun/fs/com/25/057', 'MUBARAK', 'SULEMAN', 'AGHUMIDUA', 'Computer Science', 200, 'mubarak.suleman@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000058'::uuid, 'ADUN/FS/COM/25/058', 'walter-agboje daniel ebubechukwu adun/fs/com/25/058', 'WALTER-AGBOJE', 'DANIEL', 'EBUBECHUKWU', 'Computer Science', 200, 'walteragboje.daniel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000059'::uuid, 'ADUN/FS/COM/25/059', 'michael divine chukwunonso adun/fs/com/25/059', 'MICHAEL', 'DIVINE', 'CHUKWUNONSO', 'Computer Science', 200, 'michael.divine@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000060'::uuid, 'ADUN/FS/COM/25/060', 'bardi-chiejine venessa chinaza adun/fs/com/25/060', 'BARDI-CHIEJINE', 'VENESSA', 'CHINAZA', 'Computer Science', 200, 'bardichiejine.venessa@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000061'::uuid, 'ADUN/FS/COM/25/061', 'ojeanalonye mmesoma louis adun/fs/com/25/061', 'OJEANALONYE', 'MMESOMA', 'LOUIS', 'Computer Science', 200, 'ojeanalonye.mmesoma@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000062'::uuid, 'ADUN/FS/COM/25/062', 'ekpoh godsent  adun/fs/com/25/062', 'EKPOH', 'GODSENT', NULL, 'Computer Science', 200, 'ekpoh.godsent@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000063'::uuid, 'ADUN/FS/COM/25/063', 'onuka daniel  adun/fs/com/25/063', 'ONUKA', 'DANIEL', NULL, 'Computer Science', 200, 'onuka.daniel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000064'::uuid, 'ADUN/FS/COM/25/064', 'akanmu habeeb opeyemi adun/fs/com/25/064', 'AKANMU', 'HABEEB', 'OPEYEMI', 'Computer Science', 200, 'akanmu.habeeb@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000065'::uuid, 'ADUN/FS/COM/25/065', 'michael chisom  adun/fs/com/25/065', 'MICHAEL', 'CHISOM', NULL, 'Computer Science', 200, 'michael.chisom@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000066'::uuid, 'ADUN/FS/COM/25/066', 'asase constance nguvese adun/fs/com/25/066', 'ASASE', 'CONSTANCE', 'NGUVESE', 'Computer Science', 200, 'asase.constance@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000067'::uuid, 'ADUN/FS/COM/25/067', 'aigbona collins  adun/fs/com/25/067', 'AIGBONA', 'COLLINS', NULL, 'Computer Science', 200, 'aigbona.collins@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000068'::uuid, 'ADUN/FS/COM/25/068', 'orakwe daniel light adun/fs/com/25/068', 'ORAKWE', 'DANIEL', 'LIGHT', 'Computer Science', 200, 'orakwe.daniel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000069'::uuid, 'ADUN/FS/COM/25/069', 'nwebunu ekene arthur adun/fs/com/25/069', 'NWEBUNU', 'EKENE', 'ARTHUR', 'Computer Science', 200, 'nwebunu.ekene@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000070'::uuid, 'ADUN/FS/COM/25/070', 'adaka emmanuel efe adun/fs/com/25/070', 'ADAKA', 'EMMANUEL', 'EFE', 'Computer Science', 200, 'adaka.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000071'::uuid, 'ADUN/FS/COM/25/071', 'nwigwe chukwudubem shammah adun/fs/com/25/071', 'NWIGWE', 'CHUKWUDUBEM', 'SHAMMAH', 'Computer Science', 200, 'nwigwe.chukwudubem@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000072'::uuid, 'ADUN/FS/COM/25/072', 'ngadi chelsea kamsiriochukwu adun/fs/com/25/072', 'NGADI', 'CHELSEA', 'KAMSIRIOCHUKWU', 'Computer Science', 200, 'ngadi.chelsea@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000073'::uuid, 'ADUN/FS/COM/25/073', 'ikechukwu jeffrey chinonso adun/fs/com/25/073', 'IKECHUKWU', 'JEFFREY', 'CHINONSO', 'Computer Science', 200, 'ikechukwu.jeffrey@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000074'::uuid, 'ADUN/FS/COM/25/074', 'fashola david chukwuebuka adun/fs/com/25/074', 'FASHOLA', 'DAVID', 'CHUKWUEBUKA', 'Computer Science', 200, 'fashola.david@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000075'::uuid, 'ADUN/FS/COM/25/075', 'okoye desmond chinemerem adun/fs/com/25/075', 'OKOYE', 'DESMOND', 'CHINEMEREM', 'Computer Science', 200, 'okoye.desmond@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000076'::uuid, 'ADUN/FS/COM/25/076', 'memuduaghan oritsejayo  adun/fs/com/25/076', 'MEMUDUAGHAN', 'ORITSEJAYO', NULL, 'Computer Science', 200, 'memuduaghan.oritsejayo@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000077'::uuid, 'ADUN/FS/COM/25/077', 'asogwa emeka emmanuel adun/fs/com/25/077', 'ASOGWA', 'EMEKA', 'EMMANUEL', 'Computer Science', 200, 'asogwa.emeka@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000078'::uuid, 'ADUN/FS/COM/25/078', 'otiva ian etaban adun/fs/com/25/078', 'OTIVA', 'IAN', 'ETABAN', 'Computer Science', 200, 'otiva.ian@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000079'::uuid, 'ADUN/FS/COM/25/079', 'igboeruche emmanuel onyekachi adun/fs/com/25/079', 'IGBOERUCHE', 'EMMANUEL', 'ONYEKACHI', 'Computer Science', 200, 'igboeruche.emmanuel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000080'::uuid, 'ADUN/FS/COM/25/080', 'emmanuel-oba campbell chibudom adun/fs/com/25/080', 'EMMANUEL-OBA', 'CAMPBELL', 'CHIBUDOM', 'Computer Science', 200, 'emmanueloba.campbell@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000081'::uuid, 'ADUN/FS/COM/25/081', 'chibuokem prince-favour ebube adun/fs/com/25/081', 'CHIBUOKEM', 'PRINCE-FAVOUR', 'EBUBE', 'Computer Science', 200, 'chibuokem.princefavour@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000082'::uuid, 'ADUN/FS/COM/25/082', 'erhire oghenemarho godbring adun/fs/com/25/082', 'ERHIRE', 'OGHENEMARHO', 'GODBRING', 'Computer Science', 200, 'erhire.oghenemarho@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000083'::uuid, 'ADUN/FS/COM/25/083', 'iwuchukwu joshua chinaza adun/fs/com/25/083', 'IWUCHUKWU', 'JOSHUA', 'CHINAZA', 'Computer Science', 200, 'iwuchukwu.joshua@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000084'::uuid, 'ADUN/FS/COM/25/084', 'iwebuema collins oluchukwu adun/fs/com/25/084', 'IWEBUEMA', 'COLLINS', 'OLUCHUKWU', 'Computer Science', 200, 'iwebuema.collins@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000085'::uuid, 'ADUN/FS/COM/25/085', 'ikoroje daniel  adun/fs/com/25/085', 'IKOROJE', 'DANIEL', NULL, 'Computer Science', 200, 'ikoroje.daniel@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000086'::uuid, 'ADUN/FS/COM/25/086', 'ojiakor ifechukwu david adun/fs/com/25/086', 'OJIAKOR', 'IFECHUKWU', 'DAVID', 'Computer Science', 200, 'ojiakor.ifechukwu@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000087'::uuid, 'ADUN/FS/COM/25/087', 'okemefune vera mmesoma adun/fs/com/25/087', 'OKEMEFUNE', 'VERA', 'MMESOMA', 'Computer Science', 200, 'okemefune.vera@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000088'::uuid, 'ADUN/FS/COM/25/088', 'chikwem divine amarachi adun/fs/com/25/088', 'CHIKWEM', 'DIVINE', 'AMARACHI', 'Computer Science', 200, 'chikwem.divine@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000089'::uuid, 'ADUN/FS/COM/25/089', 'orwe fatima obiageli adun/fs/com/25/089', 'ORWE', 'FATIMA', 'OBIAGELI', 'Computer Science', 200, 'orwe.fatima@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000090'::uuid, 'ADUN/FS/COM/25/090', 'unurhiere joshua ogagaooghene adun/fs/com/25/090', 'UNURHIERE', 'JOSHUA', 'OGAGAOOGHENE', 'Computer Science', 200, 'unurhiere.joshua@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000091'::uuid, 'ADUN/FS/COM/25/091', 'eguabor goodluck osasenaga adun/fs/com/25/091', 'EGUABOR', 'GOODLUCK', 'OSASENAGA', 'Computer Science', 200, 'eguabor.goodluck@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000092'::uuid, 'ADUN/FS/COM/25/092', 'nzelu chibuike godwin adun/fs/com/25/092', 'NZELU', 'CHIBUIKE', 'GODWIN', 'Computer Science', 200, 'nzelu.chibuike@student.adun.edu.ng', NULL, 'active', timezone('utc', now())),
  ('00000000-0000-0000-0001-000000000093'::uuid, 'ADUN/FS/COM/25/093', 'ndubuizu chiemerie vincent adun/fs/com/25/093', 'NDUBUIZU', 'CHIEMERIE', 'VINCENT', 'Computer Science', 200, 'ndubuizu.chiemerie@student.adun.edu.ng', NULL, 'active', timezone('utc', now()))
ON CONFLICT (matric_no) DO UPDATE SET
  surname = EXCLUDED.surname,
  first_name = EXCLUDED.first_name,
  middle_name = EXCLUDED.middle_name,
  program = EXCLUDED.program,
  level = EXCLUDED.level,
  email = EXCLUDED.email;

-- STEP 6: ENROLL ALL 93 STUDENTS INTO COURSE ROSTER FOR ADUN CYB 201
INSERT INTO course_roster (id, course_id, student_id, uploaded_by, uploaded_at)
SELECT
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000101'::uuid,
    sm.id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    timezone('utc', now())
FROM students_master sm
WHERE sm.matric_no LIKE 'ADUN/FS/COM/25/%'
ON CONFLICT (course_id, student_id) DO NOTHING;

-- Verification summary
SELECT 'Students Master Count:' AS metric, count(*)::text AS count FROM students_master
UNION ALL
SELECT 'Course Roster Count for ADUN CYB 201:', count(*)::text FROM course_roster WHERE course_id = '00000000-0000-0000-0000-000000000101'::uuid
UNION ALL
SELECT 'Active Courses Count:', count(*)::text FROM courses
UNION ALL
SELECT 'Users Count:', count(*)::text FROM users;

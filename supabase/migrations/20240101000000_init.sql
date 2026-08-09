-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. PROFILES TABLE
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    matric_number TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'lecturer', 'admin')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. FACE EMBEDDINGS TABLE
CREATE TABLE face_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    embedding vector(128) NOT NULL,
    registered_at TIMESTAMPTZ DEFAULT now()
);

-- 3. COURSES TABLE
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lecturer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_code TEXT NOT NULL,
    course_title TEXT NOT NULL,
    geofence_polygon geography(POLYGON) NOT NULL
);
-- Spatial index for geofence queries
CREATE INDEX courses_geofence_gix ON courses USING GIST (geofence_polygon);

-- 4. SESSIONS TABLE
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ DEFAULT now(),
    end_time TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- 5. ATTENDANCE TABLE
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    check_in_time TIMESTAMPTZ DEFAULT now(),
    gps_point geography(POINT) NOT NULL,
    face_match_score FLOAT,
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'GEOFENCE_FAILED', 'FACE_FAILED'))
);
-- Spatial index for attendance points
CREATE INDEX attendance_gps_gix ON attendance USING GIST (gps_point);

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------
-- RLS POLICIES
-- ----------------------------------------------------

-- Profiles Policies
CREATE POLICY "Users can read their own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Lecturers can read all student profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles AS p WHERE p.id = auth.uid() AND p.role IN ('lecturer', 'admin'))
    );

-- Face Embeddings Policies
CREATE POLICY "Students can read their own embedding" ON face_embeddings
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Students can update their own embedding" ON face_embeddings
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Students can insert their own embedding" ON face_embeddings
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Courses Policies
CREATE POLICY "Lecturers can CRUD their own courses" ON courses
    FOR ALL USING (lecturer_id = auth.uid());

CREATE POLICY "Students can read all courses" ON courses
    FOR SELECT USING (true); -- Assuming any authenticated user can read courses

-- Sessions Policies
CREATE POLICY "Lecturers can CRUD sessions for their courses" ON sessions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM courses WHERE courses.id = sessions.course_id AND courses.lecturer_id = auth.uid())
    );

CREATE POLICY "Students can read active sessions" ON sessions
    FOR SELECT USING (is_active = true);

-- Attendance Policies
CREATE POLICY "Students can insert their own attendance records" ON attendance
    FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can read their own attendance history" ON attendance
    FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Lecturers can read all attendance for their courses" ON attendance
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM sessions
            JOIN courses ON sessions.course_id = courses.id
            WHERE sessions.id = attendance.session_id AND courses.lecturer_id = auth.uid()
        )
    );

-- ----------------------------------------------------
-- DATABASE FUNCTIONS
-- ----------------------------------------------------

-- Function to check if a point is inside a course geofence
CREATE OR REPLACE FUNCTION check_geofence(p_course_id UUID, p_lng FLOAT, p_lat FLOAT) 
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the function creator (admin)
AS $$
DECLARE
    is_inside BOOLEAN;
BEGIN
    SELECT ST_Contains(
        c.geofence_polygon,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) INTO is_inside
    FROM courses c
    WHERE c.id = p_course_id;
    
    RETURN COALESCE(is_inside, FALSE);
END;
$$;

-- Function to check face cosine difference
CREATE OR REPLACE FUNCTION match_face_embedding(p_user_id UUID, p_embedding vector(128))
RETURNS FLOAT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    distance FLOAT;
BEGIN
    -- Uses pgvector <=> operator to calculate cosine distance
    SELECT (embedding <=> p_embedding) INTO distance
    FROM face_embeddings
    WHERE user_id = p_user_id;

    RETURN distance;
END;
$$;

-- Trigger to create profile when auth.users is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, matric_number, role)
  VALUES (
      new.id,
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'matric_number',
      new.raw_user_meta_data->>'role'
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enable replication for realtime dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE attendance;

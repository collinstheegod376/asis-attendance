# ASIS Portal - Attendance System

This repository contains the full infrastructure for the ASIS biometric attendance system, built with FastApi, Supabase, and Realtime dashboard features.

## Architecture

- **PostgreSQL Database** hosted by [Supabase](https://supabase.com). Includes PostGIS (geospatial geofence queries) and pgvector (biometric cosine similarity queries) natively in the DB layer.
- **FastAPI** provides the secure backend processing (webcam frames, geofence parsing, Supabase token verifications).
- **Vanilla Setup** for the Frontend highlighting realtime sync for connected dashboards.

---

## Deployment Steps

Follow these steps to deploy this infrastructure to production:

### 1. Deploying the Database (Supabase Cloud)
1. Create a brand new project on the [Supabase Dashboard](https://supabase.com/dashboard).
2. Install the Supabase CLI (`npm install -g supabase`).
3. Login into the CLI via `supabase login`.
4. Link this project repository to the newly created DB instance:
   ```bash
   supabase link --project-ref <your-project-id>
   ```
5. Push the migrations up to your live cloud DB:
   ```bash
   supabase db push
   ```

### 2. Deploying the FastAPI Backend (Render or Railway)
1. Make sure you update the `.env` file (or environmental variables dashboard in your hosting provider) with the keys generated during Supabase setup:
   ```ini
   SUPABASE_URL=https://<your-project-id>.supabase.co
   SUPABASE_ANON_KEY=<your-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   ```
2. Commit the `backend/` folder to a GitHub repository.
3. Sign into Render or Railway.app.
4. Launch a new "Web Service" and select the GitHub repository.
5. Provide your `.env` variables in the environment settings section.
6. Make sure to define the launch command, usually:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

### 3. Deploying the Frontend (Vercel)
1. If you migrated the `frontend/` code to a framework like React or Next.js, or want to launch the pure HTML files directly, Vercel/Netlify are perfect.
2. Remember to point your `const SUPABASE_URL` to your production Supabase URI in `app.js`.
3. Make sure to update the backend API endpoint for the web-cam capturing functions.
4. Connect the frontend folder to Netlify or Vercel, click deploy, and watch it go live!

# DoctorDesk

DoctorDesk is a doctor appointment application built with React, Express, Sequelize, and PostgreSQL. It has patient, doctor, and administrator workflows, with role-protected pages and API routes.

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm
- PostgreSQL

## Local setup

### 1. Create the database

Start PostgreSQL, then create an empty local database once, using `psql` or pgAdmin:

```sql
CREATE DATABASE doctordesk;
```

### 2. Configure and migrate the backend

In PowerShell:

```powershell
Set-Location .\backend
Copy-Item .env.example .env
```

Edit `backend/.env` with your local PostgreSQL host, database name, username, and password. Replace the JWT placeholder with a random secret. Never commit or share this file.

Then install dependencies and apply pending migrations:

```powershell
npm ci
npm run db:migrate
```

Migrations create/update the schema; they do not populate demo users. Run them against a local development database first. Back up important data before applying migrations to any non-disposable database. Do not use the `db:reset` script on a database with data you need to keep.

### 3. Optional: seed local demo data

The seeders create sample admin, doctor, patient, settings, and availability records. They are intended for a fresh local database and should be run once:

1. Set unique local values for `SEED_ADMIN_PASSWORD`, `SEED_DOCTOR_PASSWORD`, and `SEED_PATIENT_PASSWORD` in `backend/.env`. Use strong passwords of at least 12 characters.
2. From `backend`, run:

```powershell
npm run db:seed
```

The demo passwords are read from the ignored local `.env`; no default passwords are stored in the repository. Seed account emails are defined in `backend/src/seeders/20261116000001-seed-admin-and-users.js`. Never seed a production database.

### 4. Start the backend and frontend

Keep the backend running in one terminal:

```powershell
Set-Location .\backend
npm start
```

Keep the frontend running in a second terminal:

```powershell
Set-Location .\doctordesk-frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite development server proxies `/api` requests to `http://localhost:5001`; the backend health endpoint is `http://localhost:5001/api/health`.

## Main workflows

- Patients register at `/register`, browse approved doctors, book available slots, manage appointments, view prescriptions, and read notifications.
- Doctors register at `/register/doctor`, upload credentials, maintain their profile and availability, and manage appointments after administrator approval.
- Administrators sign in with an account provisioned for the environment. There is no public admin registration route. Admin pages cover doctor review, user management, appointments, commission, and branding.

For simultaneous role demonstrations, use separate browser profiles; tabs in one profile share authentication cookies.

## Tests and production build

Backend tests:

```powershell
Set-Location .\backend
npm test -- --runInBand
```

Frontend production build:

```powershell
Set-Location .\doctordesk-frontend
npm run build
```

## Project layout

- `doctordesk-frontend/src`: React routes, role-specific pages, auth context, and API services.
- `backend/src/routes` and `backend/src/controllers`: HTTP routing and request/response handling.
- `backend/src/services`: business rules and transactional workflows.
- `backend/src/middleware` and `backend/src/validators`: authentication, authorization, upload handling, and request validation.
- `backend/src/models` and `backend/src/migrations`: Sequelize models and PostgreSQL schema history.
- `backend/tests`: backend regression and workflow tests.

Environment files, dependency directories, generated frontend output, and uploaded certificates/logos are excluded from Git. Keep real user data and credentials out of source control.

# DoctorDesk frontend

## Local development

The backend listens on port `5001` by default. Configure its database and JWT settings in `backend/.env` using `backend/.env.example` as a template, then run:

```powershell
cd ..\backend
npm install
npm start
```

In another terminal:

```powershell
cd doctordesk-frontend
npm install
npm run dev
```

Vite serves the frontend on port `5173` and proxies `/api` requests to `http://localhost:5001`, preserving same-origin HTTP-only authentication cookies. Set `VITE_API_PROXY_TARGET` to override the development proxy. For deployments where the API is hosted separately, set `VITE_API_BASE_URL` to the API's `/api` URL and configure backend `FRONTEND_URL` for CORS.

Run `npm run build` to create the production frontend bundle and `npm run lint` for Oxlint.

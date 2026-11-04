# SmartAg Ops Advisor

SmartAg Ops Advisor is a full-stack agriculture operations platform for comparing mandi prices, managing crop stock, booking trucks, tracking deliveries, and recording trade reports. It uses a React frontend, a FastAPI backend, and a PostgreSQL database.

## Features

- JWT authentication with role-based access control
- Roles: farmer, marketer, buyer, truck operator, market price manager, admin
- Crop stock management and market price comparison
- Truck discovery, booking, and trip status tracking
- Live location sharing for active deliveries
- Dashboard, reports, and notifications backed by database records
- Multilingual UI support

## Compare Markets (PRD v4.2)

A tomato grower enters a batch and its costs and sees, per 14 kg crate, which comparable market leaves the most money and whether the batch covers picking and selling costs. When the data cannot support a ranking, the page says why. It is a normal signed-in page: **Compare Markets** in the menu (`/compare`), open to every role except admin, like the other farmer workflow pages.

Run it locally (about 5 minutes; SQLite, no Postgres needed). Use **Python 3.12**: the pinned `pydantic==2.10.4` has no wheels for Python 3.13 or newer, so `pip install` fails there. On Windows, install 3.12 from python.org and create the venv with `py -3.12`.

```powershell
# Backend (terminal 1)
Set-Location agri-project\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:DATABASE_URL = "sqlite:///./local-demo.db"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Frontend (terminal 2)
Set-Location agri-project\frontend
npm install
$env:VITE_API_URL = "http://127.0.0.1:8000"
npm run dev
```

Open http://localhost:5173, create a Farmer account from the sign-in page, and choose **Compare Markets** in the menu. In development the backend loads the eight labelled PRD sample prices (Dindigul district, 24 Oct 2026) on first start, so every screen shows "Sample data as of 25 Oct 2026". Production (`ENVIRONMENT=production`) does not seed at startup: run `python -m scripts.seed_decision` from `agri-project/backend` once, or set `DECISION_SEED_ON_START=true`.

| Try this | Expected state |
|---|---|
| Oddanchatram (trip 1800) + Palani (trip 3000), 700 kg, capacity 1000, picking 80 | RANKED: Palani by Rs 300; Rs 4 and Rs 10 left per crate |
| Same, Palani trip 3250 | TOO_CLOSE (difference Rs 50) |
| Leave one trip cost blank | NEEDS_INPUT |
| Oddanchatram + Dindigul Uzhavar Sandhai | INSUFFICIENT_MARKETS (different market type) |
| Add Vedasandur, Batlagundu, Nilakottai or Natham | Listed under "Not ranked" with the reason |
| Quantity 0 | Field error, no result |

API: `GET /api/decision/options`, `POST /api/decision/compare` (signed-in, non-admin roles). All calculation rules are in `backend/app/services/decision_engine.py`. Tests: `python -m pytest -v` in `agri-project/backend` (acceptance tests AT-01 to AT-18 plus API tests for every result state). GitHub Actions (`.github/workflows/ci.yml`) runs these tests on Python 3.12, the frontend build, and a gitleaks secret scan on every pull request and every push to `main`.

Settings (backend `.env`): `DECISION_DATA_MODE` (`sample` | `snapshot`), `DECISION_AS_OF` (the date freshness is judged against; empty means 25 Oct 2026 in sample mode and today in IST in snapshot mode), `DECISION_FRESHNESS_DAYS`, `DECISION_TIE_BAND_FLOOR`, `DECISION_TIE_BAND_PCT`, `DECISION_SEED_ON_START`.

## Tech Stack

- **Frontend:** React 18, Vite, React Router, Axios
- **Backend:** FastAPI, SQLAlchemy, Pydantic, Uvicorn
- **Database:** PostgreSQL
- **AI:** Gemini API for the agricultural assistant
- **Auth:** JWT (`python-jose`), bcrypt password hashing

## Project Structure

```
agri-project/
├── backend/
│   ├── app/
│   │   ├── core/        # config, database, security
│   │   ├── models/      # SQLAlchemy models
│   │   ├── routers/     # API endpoints
│   │   └── schemas/     # Pydantic schemas
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── components/
    │   ├── context/
    │   ├── pages/
    │   └── services/
    ├── package.json
    └── .env.example
```

## Prerequisites

- Python 3.12 (3.13 and newer cannot install the pinned `pydantic==2.10.4`)
- Node.js 18+
- PostgreSQL 14+

## Backend Setup

```bash
cd agri-project/backend

python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file from `.env.example`:

```env
SECRET_KEY=replace-with-a-long-random-secret
DATABASE_URL=postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/agri
FRONTEND_URL=http://localhost:5173
ADDITIONAL_FRONTEND_ORIGINS=https://agri-project-frontend-2bf3.onrender.com
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-flash-latest
GEMINI_TIMEOUT_SECONDS=180
SEED_DEMO_DATA=false
```

Set `GEMINI_API_KEY` in the backend `.env` file. The key stays on the backend
and is never exposed to the frontend.

Create the PostgreSQL database:

```bash
createdb -h 127.0.0.1 -U postgres agri
```

Start the API:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API docs are available at http://127.0.0.1:8000/docs.

## Frontend Setup

```bash
cd agri-project/frontend
npm install
```

Create `.env` from `.env.example`:

```env
VITE_API_URL=https://smartag-ops-backend.onrender.com
```

Start the development server:

```bash
npm run dev
```

The frontend now uses the deployed Render backend by default. Set
`VITE_API_URL` to another API origin only when intentionally targeting a
different backend. Open http://localhost:5173.

## Creating an Account

The application starts with an empty operational database. Register a new account from the login page and choose the appropriate role. Admin users can manage roles from the Admin page after signing in.

## API Overview

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/auth/signup` | Register a user |
| POST | `/api/auth/login` | Sign in and receive a JWT |
| GET | `/api/auth/me` | Current user profile |
| GET/POST | `/api/crops` | List or create crop stock |
| GET | `/api/markets` | List markets |
| GET | `/api/markets/compare` | Compare net proceeds across markets |
| GET | `/api/decision/options` | Regions, crops and markets for Compare Markets |
| POST | `/api/decision/compare` | Rank 2-3 markets by estimate after entered costs |
| GET/POST | `/api/prices` | List or publish market prices |
| GET/POST | `/api/trucks` | List or register trucks |
| GET/POST | `/api/bookings` | List or create bookings |
| GET | `/api/dashboard` | Dashboard summary |
| GET | `/api/reports` | Operational reports |
| GET | `/api/health` | Health check |

## License

See [LICENSE](LICENSE).

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

- Python 3.12+
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
| GET/POST | `/api/prices` | List or publish market prices |
| GET/POST | `/api/trucks` | List or register trucks |
| GET/POST | `/api/bookings` | List or create bookings |
| GET | `/api/dashboard` | Dashboard summary |
| GET | `/api/reports` | Operational reports |
| GET | `/api/health` | Health check |

## License

See [LICENSE](LICENSE).

# Salon Management Backend

## Endpoints

- `/api/v1/auth` — Login, JWT, password management
- `/api/v1/staff` — Staff CRUD
- `/api/v1/shifts` — Shift scheduling (single + recurring)
- `/api/v1/services` — Service catalog + commission overrides
- `/api/v1/availability` — Slot computation
- `/api/v1/bookings` — Booking lifecycle
- `/api/v1/clients` — Client management + search
- `/api/v1/payments` — Payments with M-Pesa deduplication
- `/api/v1/cash-up` — Daily reconciliation (DB-locked)
- `/api/v1/payroll` — Monthly payroll with commission engine (DB-locked)

## Setup

1. `npm install`
2. `docker compose up -d`
3. `npx prisma generate`
4. `npx prisma migrate deploy`
5. `npx tsx prisma/seed.ts`
6. `npm run dev`

## Environment Variables

See `.env.example` for required variables.

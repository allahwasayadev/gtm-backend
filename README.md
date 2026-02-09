# GTM Backend

Backend API for the GTM (Go To Market) Account Mapper application, built with [NestJS](https://nestjs.com/) and [Prisma](https://www.prisma.io/).

## Tech Stack

- **Framework**: NestJS 11 (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma 5
- **Authentication**: JWT + Passport + bcrypt
- **File Parsing**: CSV (`csv-parser`) and Excel (`xlsx`)
- **File Uploads**: Multer
- **Validation**: class-validator / class-transformer

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **PostgreSQL** installed and running locally

## Getting Started

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Set up PostgreSQL

Make sure PostgreSQL is running, then create the database:

```bash
createdb gtm_db
```

### 3. Configure environment variables

Copy the example env file and update it with your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your database connection details:

```env
DATABASE_URL="postgresql://<username>:<password>@localhost:5432/gtm_db?schema=public"
PORT=3001
JWT_SECRET=your-secret-key-here
```

| Variable       | Description                          | Default                  |
|----------------|--------------------------------------|--------------------------|
| `DATABASE_URL` | PostgreSQL connection string         | *(required)*             |
| `PORT`         | Port the API server runs on          | `3001`                   |
| `JWT_SECRET`   | Secret key used to sign JWT tokens   | *(required)*             |

### 4. Set up the database schema

Generate the Prisma client and push the schema to your database:

```bash
npm run prisma:generate
npm run db:push
```

Or, if you want to use migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5. Start the development server

```bash
npm run start:dev
```

The API will be available at **http://localhost:3001**.

## Available Scripts

| Script                | Description                              |
|-----------------------|------------------------------------------|
| `npm run start:dev`   | Start in watch mode (development)        |
| `npm run start`       | Start without watch mode                 |
| `npm run start:prod`  | Start production build                   |
| `npm run build`       | Build the project                        |
| `npm run lint`        | Run ESLint with auto-fix                 |
| `npm run format`      | Format code with Prettier                |
| `npm run test`        | Run unit tests                           |
| `npm run test:watch`  | Run tests in watch mode                  |
| `npm run test:cov`    | Run tests with coverage                  |
| `npm run test:e2e`    | Run end-to-end tests                     |
| `npm run prisma:generate` | Generate Prisma client              |
| `npm run prisma:migrate`  | Run database migrations             |
| `npm run prisma:studio`   | Open Prisma Studio (DB browser)     |
| `npm run db:push`     | Push schema to database (no migration)   |
| `npm run db:reset`    | Reset database (drops all data)          |

## API Endpoints

### Auth

| Method | Endpoint          | Description         | Auth Required |
|--------|-------------------|---------------------|---------------|
| POST   | `/auth/signup`    | Register a new user | No            |
| POST   | `/auth/login`     | Login and get token | No            |
| GET    | `/auth/profile`   | Get current user    | Yes           |

### Account Lists

| Method | Endpoint                            | Description                   | Auth Required |
|--------|-------------------------------------|-------------------------------|---------------|
| POST   | `/account-lists/upload`             | Upload CSV/Excel file         | Yes           |
| GET    | `/account-lists`                    | Get all user's account lists  | Yes           |
| GET    | `/account-lists/:id`                | Get a single list with accounts | Yes         |
| PUT    | `/account-lists/:id/accounts`       | Update accounts in a list     | Yes           |
| POST   | `/account-lists/:id/publish`        | Publish a list (set active)   | Yes           |
| DELETE | `/account-lists/:id`                | Delete an account list        | Yes           |

### Connections

| Method | Endpoint                        | Description                  | Auth Required |
|--------|---------------------------------|------------------------------|---------------|
| POST   | `/connections`                  | Send a connection request    | Yes           |
| GET    | `/connections`                  | Get all user's connections   | Yes           |
| POST   | `/connections/:id/accept`       | Accept a connection request  | Yes           |
| DELETE | `/connections/:id`              | Delete/reject a connection   | Yes           |

### Matching

| Method | Endpoint                                | Description                        | Auth Required |
|--------|-----------------------------------------|------------------------------------|---------------|
| GET    | `/matching/connections/:connectionId`   | Get matched accounts for a connection | Yes        |

### Health

| Method | Endpoint   | Description        | Auth Required |
|--------|------------|--------------------|---------------|
| GET    | `/health`  | API health check   | No            |

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── auth/                  # Authentication (signup, login, JWT)
│   ├── account-lists/         # Account list CRUD & file upload
│   ├── connections/           # User-to-user connections
│   ├── matching/              # Account matching algorithm
│   ├── health/                # Health check endpoint
│   ├── prisma/                # Prisma service (DB client)
│   ├── app.module.ts          # Root module
│   └── main.ts                # App entry point
├── test/                      # E2E tests
├── .env.example               # Environment template
└── package.json
```

## Database Models

- **User** — registered users with hashed passwords
- **AccountList** — named lists of accounts (draft/active status)
- **Account** — individual accounts with normalized names for matching
- **Connection** — user-to-user connection requests (pending/accepted/rejected)

## Troubleshooting

- **`prisma generate` fails**: Make sure `@prisma/client` and `prisma` are installed and your `schema.prisma` is valid.
- **Cannot connect to database**: Verify PostgreSQL is running and `DATABASE_URL` in `.env` is correct.
- **Port already in use**: Change the `PORT` value in `.env` or stop the other process.

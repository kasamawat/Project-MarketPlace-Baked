# Marketplace Platform — **Backend**

> NestJS + MongoDB + RabbitMQ + Stripe • Production‑ready backend for a multi‑store marketplace with products, variants, orders, payments, inventory reservation, webhooks, and real‑time notifications.

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.x-informational)](https://nodejs.org/) [![NestJS](https://img.shields.io/badge/nestjs-Framework-red)](https://nestjs.com/) [![MongoDB](https://img.shields.io/badge/mongodb-6.x-brightgreen)](https://www.mongodb.com/) [![RabbitMQ](https://img.shields.io/badge/rabbitmq-3.12-orange)](https://www.rabbitmq.com/) [![Stripe](https://img.shields.io/badge/stripe-payments-blue)](https://stripe.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Install & Run](#install--run)
  - [Docker Compose (optional)](#docker-compose-optional)
- [Project Structure](#project-structure)
- [API Quickstart](#api-quickstart)
  - [Auth](#auth)
  - [Store](#store)
  - [Products & Inventory](#products--inventory)
  - [Orders](#orders)
  - [Payments (Stripe)](#payments-stripe)
  - [Webhooks](#webhooks)
  - [Notifications / SSE](#notifications--sse)
- [Message Topology](#message-topology)
- [Testing](#testing)
- [Deployment Notes](#deployment-notes)
- [Security Notes](#security-notes)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview
This service powers the **Marketplace Platform** backend. It exposes REST APIs for user auth, store management, product & variant modeling, order placement, payment processing via Stripe, fulfillment lifecycle, and emits domain events via RabbitMQ to keep other services and the frontend updated in real time (SSE).

## Features
- **Multi‑store** accounts (register store, manage profile, policies)
- **Products & Variants** with SKUs, pricing tiers, images, and stock tracking
- **Inventory Reservation** (atomic reserve/commit/release around order flow)
- **Checkout & Orders** (master order + per‑store orders split)
- **Payments** via **Stripe** (PaymentIntent), **COD** option supported
- **Webhooks**: Stripe payments, Carrier status updates → update orders/events
- **Notifications** via **RabbitMQ** exchanges; **SSE** stream for clients
- **Search & Filtering** (server‑side), pagination, sorting
- **Role & Permission** hooks (buyer, store owner, admin)
- **Production‑ready**: linting, formatting, environment‑based config, error handling

## Architecture
```
[ Client (Next.js) ]  ⇄  [ Backend (NestJS) ]  ⇄  [ MongoDB ]
        │                           │
        │     publish/consume       │
        └───────────────▶  [ RabbitMQ Exchanges ]  ◀──────────────┐
                                │                                  │
                             webhooks                            workers
                                │                                  │
                           [ Stripe ]                         [ Consumers ]

Real‑time: Backend pushes server‑sent events (SSE) to clients listening on /sse
```

## Tech Stack
- **Runtime**: Node.js ≥ 18
- **Framework**: NestJS (REST controllers, DI, Pipes, Guards)
- **Database**: MongoDB (Mongoose)
- **Messaging**: RabbitMQ (amqplib / connection‑manager)
- **Payments**: Stripe (PaymentIntent + Webhooks)
- **Auth**: JWT (httpOnly cookies), Passport
- **DevX**: ESLint, Prettier, Nest CLI

## Getting Started

### Prerequisites
- Node.js **18+**
- MongoDB **6.x** (local or Atlas)
- RabbitMQ **3.12+** (management plugin recommended)
- Stripe account + API keys (test mode okay)

### Environment Variables
Create a `.env` in project root:
```env
# App
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=replace-with-strong-secret
JWT_EXPIRES=7d

# MongoDB
MONGO_URI=mongodb://localhost:27017/marketplace

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Files/Images (optional if using external storage)
FILES_BASE_URL=http://localhost:3001
```

> **Tip:** keep a separate `.env.test` and `.env.prod` for different environments.

### Install & Run
```bash
# 1) Install deps
npm install

# 2) Start in dev mode (watch)
npm run start:dev

# 3) Lint / format
npm run lint
npm run format
```

### Docker Compose (optional)
Spin up MongoDB, RabbitMQ, and the app in one go:
```yaml
version: '3.9'
services:
  mongo:
    image: mongo:6
    ports: ["27017:27017"]
    volumes:
      - mongo_data:/data/db

  rabbitmq:
    image: rabbitmq:3.12-management
    ports:
      - "5672:5672"   # AMQP
      - "15672:15672" # UI

  api:
    build: .
    environment:
      - NODE_ENV=development
      - PORT=3001
      - MONGO_URI=mongodb://mongo:27017/marketplace
      - RABBITMQ_URL=amqp://rabbitmq:5672
      - RABBITMQ_EXCHANGE=marketplace.events
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
    ports: ["3001:3001"]
    depends_on: [mongo, rabbitmq]

volumes:
  mongo_data:
```

## Project Structure
```
src/
  main.ts                 # bootstrap, CORS, cookies, global pipes
  app.module.ts           # root module (Config, Mongoose, Messaging, etc.)

  common/                 # interceptors, filters, decorators, guards
  config/                 # ConfigModule factories for envs

  auth/                   # login/register, JWT strategy, guards
  users/                  # user profile, addresses
  stores/                 # store register/update, policies
  products/               # product, variants, SKUs, images, search indexes
  inventory/              # reservation, commit, release
  orders/                 # master order + per-store orders, status transitions
  payments/               # Stripe service, checkout controller
  webhooks/               # Stripe webhook handler, carrier callbacks
  notifications/          # RabbitMQ publisher + event DTOs
  sse/                    # server-sent events stream endpoint
```

> Names may vary; adjust the tree to match the real modules in this repo.

## API Quickstart

### Auth
```http
POST /auth/register
POST /auth/login           # sets httpOnly cookie
POST /auth/logout
GET  /auth/me              # current user
```

### Store
```http
GET    /store/me
PUT    /store/updateInfo
POST   /store/logo         # upload logo
```

### Products & Inventory
```http
POST   /products
PATCH  /products/:id
POST   /products/:id/images
GET    /products?query=&sort=&page=&limit=

# SKU & stock
PATCH  /skus/:id/price
PATCH  /skus/:id/stock

# Reservation flow
POST   /inventory/reserve          # holds stock for a draft order
POST   /inventory/commit           # commit after payment succeeds
POST   /inventory/release          # release on cancel/expire
```

### Orders
```http
POST   /orders/checkout            # create master + store orders
GET    /orders/:id                 # detail (includes per-store items)
GET    /orders?tab=to_fulfill      # server-side tabs
PATCH  /orders/:id/cancel
```

### Payments (Stripe)
```http
POST   /payments/create-intent     # returns clientSecret
GET    /payments/:id               # payment status
```

### Webhooks
```http
POST /webhooks/stripe              # verify signature, update orders, emit events
POST /webhooks/carrier             # carrier → shipped/delivered → emit events
```

### Notifications / SSE
```http
GET /sse/stream                    # auth token via cookie or query
```
Push events (examples):
```json
{
  "type": "orders.paid",
  "masterOrderId": "...",
  "storeOrders": ["..."],
  "timestamp": "2025-09-20T10:00:00Z"
}
```

## Message Topology
- **Exchange**: `marketplace.events` (topic)
- **Routing keys** (suggested):
  - `payments.succeeded`, `payments.failed`, `payments.canceled`
  - `orders.created`, `orders.paid`, `orders.canceled`, `orders.expired`
  - `fulfillment.shipped`, `fulfillment.delivered`, `fulfillment.returned`
- **Queues** (examples):
  - `notify.sse`
  - `inventory.worker`
  - `analytics.events`

## Deployment Notes
- **Docker**: build image per environment, inject env vars at runtime
- **PM2**: optional for process management on VM/Windows/IIS reverse proxy
- **CORS & cookies**: set `CORS_ORIGIN` and `cookie` options for JWT cookie
- **Stripe**: use separate webhook secrets per env; verify signatures
- **Mongo indexes**: create indexes for product text/infix search, orders by dates

## Security Notes
- Use **httpOnly + Secure** cookies for JWT in production
- Rotate **JWT_SECRET** and **Stripe keys** per env; never commit to VCS
- Validate all webhook signatures; rate‑limit public endpoints
- Principle of least privilege in MongoDB user & RabbitMQ vhost

## Roadmap
- [ ] Soft delete for products/SKUs
- [ ] Admin dashboards for disputes/refunds
- [ ] Idempotency keys across checkout/placement
- [ ] Partner webhooks for stores



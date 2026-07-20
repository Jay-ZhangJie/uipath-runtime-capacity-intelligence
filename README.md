# Runtime Capacity Intelligence

Runtime Capacity Intelligence is a read-only React and TypeScript application for analyzing UiPath Orchestrator runtime capacity, schedules, machine templates, and job activity.

## Local development

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

## Configuration

Copy `.env.example` to `.env.local` and provide your own UiPath non-confidential External Application settings. Do not commit `.env.local`, access tokens, credentials, tenant identifiers, organization identifiers, or operational data.

## Validation

```powershell
npm run build
```

This repository contains application source only. It does not include deployment-specific configuration, customer data, internal planning documents, or generated reports.
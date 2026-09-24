# MMM Art Studio: 7-Stage Jenkins DevOps Pipeline

**SIT753 Professional Practice in IT | Task 7.3HD | Nicolas Lai**

A class-booking web app for a fictional art studio (originally built in SIT774 Task 10.3HD),
taken through a fully automated Jenkins pipeline:

```
git push ─► Build ─► Test ─► Code Quality ─► Security ─► Deploy ─► Release ─► Monitoring
            Docker    Jest    ESLint +        npm audit   staging   production  Prometheus
            image     Super-  SonarQube       + Trivy     :3001     :3000 +     Grafana
            v1.0.N    test    Quality Gate                          rollback    Alertmanager
```

## The app
| Feature | Endpoint |
|---|---|
| Live seat availability | `GET /api/classes`, `GET /api/classes/:id` |
| Concurrency-safe booking (SQLite `BEGIN IMMEDIATE`) | `POST /api/bookings` |
| Waitlist for full classes | `POST /api/waitlist` |
| Email confirmation (Nodemailer, falls back to console) | on booking |
| Health check | `GET /health` |
| Prometheus metrics | `GET /metrics` |

## Tech stack
Node.js 24 · Express · SQLite (`node:sqlite`) · vanilla JS front end · Docker · Docker Compose ·
Jenkins · Jest + Supertest · ESLint · SonarQube · npm audit · Trivy · prom-client · Prometheus ·
Grafana · Alertmanager



## Repo layout
```
server.js, notify.js        app (Express + booking logic + metrics)
public/                     front end
scripts/seed.js             creates tables + sample classes
tests/unit, tests/integration
Dockerfile, .dockerignore   hardened multi-stage image (non-root, no npm at runtime)
docker-compose.yml, env/    staging + production environments
Jenkinsfile                 the 7-stage pipeline
sonar-project.properties, eslint.config.js, .trivyignore
monitoring/                 Prometheus, alert rules, Alertmanager, Grafana dashboard
jenkins/Dockerfile          custom Jenkins image (Docker CLI, Node 24, Trivy, plugins)
```

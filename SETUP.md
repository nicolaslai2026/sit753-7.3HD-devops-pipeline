# SETUP: run the 7.3HD pipeline from zero (Mac + Docker Desktop)

Everything runs on one shared Docker network called `devops`:

| Container | What it is | Open in browser |
|---|---|---|
| `jenkins` | Jenkins (custom image with Docker CLI, Node 24, Trivy) | http://localhost:8083 |
| `sonarqube` | Code quality server | http://localhost:9000 |
| `mmm-staging` | App, test environment | http://localhost:3001 |
| `mmm-production` | App, production | http://localhost:3000 |
| `mmm-prometheus` | Metrics + alert rules | http://localhost:9090 |
| `mmm-alertmanager` | Alert routing | http://localhost:9093 |
| `mmm-grafana` | Dashboard (admin / admin) | http://localhost:3300 |

> Docker Desktop → Settings → Resources: give it **at least 6 GB memory** (SonarQube is hungry).

---

## Step 1: Put the code on GitHub
1. Create a new repo on GitHub: `sit753-7.3HD-devops-pipeline`.
2. In Terminal, inside this folder:
   ```bash
   git init
   git add .
   git commit -m "MMM Art Studio + 7-stage Jenkins pipeline"
   git branch -M main
   git remote add origin https://github.com/nicolaslai2026/sit753-7.3HD-devops-pipeline.git
   git push -u origin main
   ```
3. Repo → Settings → Collaborators → add your **marking tutor AND the Unit Chair**.

## Step 2: Create the shared network
```bash
docker network create devops
```

## Step 3: Build and start Jenkins
```bash
# stop your old 7.1C Jenkins so the port is free (it is NOT deleted)
docker stop jenkins-71c

# build the custom Jenkins image (takes a few minutes the first time)
docker build -t mmm-jenkins ./jenkins

docker run -d --name jenkins --user root --network devops \
  -p 8083:8080 -p 50000:50000 \
  -v jenkins_home_73hd:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  mmm-jenkins

# unlock password
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```
Open http://localhost:8083 → paste password → **Install suggested plugins** → create admin user.

Check it can reach Docker:
```bash
docker exec jenkins docker ps
docker exec jenkins node --version     # v24.x
docker exec jenkins trivy --version
```

## Step 4: Start SonarQube
```bash
docker run -d --name sonarqube --network devops -p 9000:9000 sonarqube:community
```
Wait ~1–2 min, open http://localhost:9000 → login `admin` / `admin` → set a new password.

1. **Token:** avatar (top right) → My Account → Security → Generate token (type *Global Analysis*). Copy it.
2. **Custom Quality Gate:** Quality Gates → Create `MMM Gate` → add conditions on **Overall Code**:

   | Metric | Fails when |
   |---|---|
   | Coverage | is less than 80% |
   | Duplicated Lines (%) | is greater than 3% |
   | Maintainability Rating | is worse than A |
   | Reliability Rating | is worse than A |
   | Security Rating | is worse than A |

   Then click **Set as Default**.
3. **Webhook** (lets Jenkins know when the gate is done): Administration → Configuration → Webhooks → Create
   - Name: `jenkins`   URL: `http://jenkins:8080/sonarqube-webhook/`

## Step 5: Configure Jenkins
**Manage Jenkins → Credentials → System → Global → Add Credentials**

| Kind | ID | Value |
|---|---|---|
| Secret text | `sonar-token` | the SonarQube token |
| Secret text | `mmm-session-secret` | output of `openssl rand -hex 32` |
| Username with password | `github-token` *(optional)* | GitHub username + a Personal Access Token (repo scope). Lets Jenkins push release tags. |
| Username with password | `alert-email` *(optional)* | Gmail address + Gmail App Password (like 7.1C). Alerts get emailed. |

**Manage Jenkins → System → SonarQube servers** → Add
- Name: `SonarQube` (exactly this)   URL: `http://sonarqube:9000`   Token: `sonar-token`

## Step 6: Create the pipeline job
New Item → `mmm-art-studio-pipeline` → **Pipeline** → OK
- Pipeline → Definition: **Pipeline script from SCM**
- SCM: Git → Repository URL: your repo (add `github-token` as credentials if the repo is private)
- Branch: `*/main`   Script Path: `Jenkinsfile`
- Save → **Build Now**

After the first build, the `pollSCM` trigger is registered: every `git push` starts a new build within ~2 min.

## Step 7: Check everything
- Stage View: 7 green stages
- http://localhost:3001 (staging) and http://localhost:3000 (production) show the booking page
- http://localhost:3300 → Dashboards → MMM Art Studio → Production

## Step 8: Incident simulation (for the video)
```bash
docker stop mmm-production
```
- ~30s later: http://localhost:9090/alerts shows **MMMProductionDown** firing (red)
- Grafana "Production up" panel drops to 0
- Alertmanager (and your inbox, if `alert-email` is set) receives the alert
```bash
docker start mmm-production     # alert resolves
```
Bonus: the **MMMClassFullyBooked** alert already fires for *Adult Life Drawing* (seeded full). That's a business alert, not just a technical one.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: not found` / permission denied in Build | Jenkins wasn't started with `--user root` and the `docker.sock` mount. Redo Step 3. |
| `Could not resolve host: mmm-staging` | Jenkins isn't on the network: `docker network connect devops jenkins` |
| Code Quality stuck on "waiting for quality gate" | SonarQube webhook missing or wrong URL (Step 4.3) |
| `No SonarQube server named SonarQube` | Name in Manage Jenkins → System must be exactly `SonarQube` |
| Deploy: `SESSION_SECRET is required` | Add the `mmm-session-secret` credential (Step 5) |
| SonarQube container keeps stopping | Give Docker Desktop more memory |
| Port already in use | `docker ps` → stop whatever is on that port |

// =============================================================================
//  MMM Art Studio: 7-stage DevOps pipeline (SIT753 Task 7.3HD)
//  Build -> Test -> Code Quality -> Security -> Deploy -> Release -> Monitoring
// =============================================================================
pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')          // every push to GitHub starts the pipeline automatically
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        IMAGE      = 'mmm-art-studio'
        VERSION    = "1.0.${env.BUILD_NUMBER}"      // semantic-ish version per build
        DOCKER_NET = 'devops'                       // shared network: Jenkins, SonarQube, app, monitoring
    }

    stages {

        // ---------------------------------------------------------------- 1
        stage('Build') {
            steps {
                script {
                    env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                echo "Building ${IMAGE} v${VERSION} from commit ${GIT_SHA}"
                sh 'node --version && npm --version'
                sh 'npm ci --no-audit --no-fund'
                sh '''
                    docker build \
                      --build-arg APP_VERSION=$VERSION \
                      -t $IMAGE:$VERSION -t $IMAGE:$GIT_SHA -t $IMAGE:latest .
                    docker image ls $IMAGE
                '''
                // Store the artefact in Jenkins (versioned + fingerprinted = traceable to a commit)
                sh 'docker save $IMAGE:$VERSION | gzip > $IMAGE-$VERSION.tar.gz'
                archiveArtifacts artifacts: "${IMAGE}-${VERSION}.tar.gz", fingerprint: true
            }
        }

        // ---------------------------------------------------------------- 2
        stage('Test') {
            steps {
                // Jest unit tests (booking logic, validation) + Supertest integration tests (HTTP API).
                // Coverage threshold in package.json: build FAILS if line coverage < 80%.
                sh 'npm test'
            }
            post {
                always {
                    junit 'reports/junit.xml'
                    archiveArtifacts artifacts: 'reports/coverage/**', allowEmptyArchive: true
                }
            }
        }

        // ---------------------------------------------------------------- 3
        stage('Code Quality') {
            steps {
                // 3a. Custom ESLint rules (complexity, max-depth, eqeqeq...). Any error fails the build.
                sh 'npm run lint'

                // 3b. SonarQube analysis + custom Quality Gate
                withSonarQubeEnv('SonarQube') {
                    sh '''
                        npx --yes @sonar/scan \
                          -Dsonar.host.url=$SONAR_HOST_URL \
                          -Dsonar.token=$SONAR_AUTH_TOKEN \
                          -Dsonar.projectVersion=$VERSION
                    '''
                }
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true   // red gate = pipeline stops here
                }
            }
        }

        // ---------------------------------------------------------------- 4
        stage('Security') {
            steps {
                // 4a. Dependency CVEs. Gate: any HIGH/CRITICAL fails the build.
                sh 'npm audit --omit=dev --json > npm-audit.json || true'
                sh 'npm audit --omit=dev --audit-level=high'

                // 4b. Secrets + Dockerfile misconfigurations in the repo (report only)
                sh 'trivy fs --scanners secret,misconfig --format table . | tee trivy-fs.txt'

                // 4c. Container image CVEs. Full HIGH/CRITICAL report, then gate on CRITICAL.
                sh '''
                    trivy image --severity HIGH,CRITICAL --ignorefile .trivyignore \
                      --format table $IMAGE:$VERSION | tee trivy-image.txt
                    trivy image --severity CRITICAL --ignore-unfixed --ignorefile .trivyignore \
                      --exit-code 1 --quiet $IMAGE:$VERSION
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'npm-audit.json, trivy-*.txt', allowEmptyArchive: true
                }
            }
        }

        // ---------------------------------------------------------------- 5
        stage('Deploy') {
            steps {
                withCredentials([string(credentialsId: 'mmm-session-secret', variable: 'SESSION_SECRET')]) {
                    sh '''
                        IMAGE_TAG=$VERSION ENV_NAME=staging HOST_PORT=3001 \
                          docker compose -p mmm-staging up -d --remove-orphans
                    '''
                }
                // Post-deploy verification: health + a real API call
                sh '''
                    for i in $(seq 1 20); do
                      curl -fs http://mmm-staging:3000/health && break
                      echo "waiting for staging... ($i)"; sleep 3
                    done
                    curl -fs http://mmm-staging:3000/health | grep -q "\\"version\\":\\"$VERSION\\""
                    curl -fs http://mmm-staging:3000/api/classes | grep -q "Watercolour"
                    echo "Staging v$VERSION is healthy at http://localhost:3001"
                '''
            }
        }

        // ---------------------------------------------------------------- 6
        stage('Release') {
            when {
                expression { (env.GIT_BRANCH ?: 'main').endsWith('main') }   // only main goes to production
            }
            steps {
                withCredentials([string(credentialsId: 'mmm-session-secret', variable: 'SESSION_SECRET')]) {
                    sh '''
                        # Keep the current production image so we can roll back
                        docker image inspect $IMAGE:production >/dev/null 2>&1 \
                          && docker tag $IMAGE:production $IMAGE:production-previous || true

                        # Promote the exact image that passed every earlier stage
                        docker tag $IMAGE:$VERSION $IMAGE:production
                        IMAGE_TAG=production ENV_NAME=production HOST_PORT=3000 \
                          docker compose -p mmm-production up -d --remove-orphans

                        healthy=false
                        for i in $(seq 1 20); do
                          if curl -fs http://mmm-production:3000/health | grep -q "\\"version\\":\\"$VERSION\\""; then
                            healthy=true; break
                          fi
                          echo "waiting for production... ($i)"; sleep 3
                        done

                        if [ "$healthy" != "true" ]; then
                          echo "Production health check FAILED, rolling back"
                          docker tag $IMAGE:production-previous $IMAGE:production
                          IMAGE_TAG=production ENV_NAME=production HOST_PORT=3000 \
                            docker compose -p mmm-production up -d --force-recreate
                          exit 1
                        fi
                        echo "Production now running v$VERSION at http://localhost:3000"
                    '''
                }
                // Tag the release in Git so every production version maps to a commit
                script {
                    try {
                        withCredentials([usernamePassword(credentialsId: 'github-token',
                                usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
                            sh '''
                                git -c user.name=jenkins -c user.email=jenkins@localhost tag -a "v$VERSION" -m "Release v$VERSION (build $BUILD_NUMBER)"
                                REPO=$(git config --get remote.origin.url | sed 's#https://##')
                                git push "https://$GH_USER:$GH_TOKEN@$REPO" "v$VERSION"
                            '''
                        }
                    } catch (err) {
                        echo "Git tag push skipped (${err.getMessage()}). Image is still tagged v${VERSION}."
                    }
                }
            }
        }

        // ---------------------------------------------------------------- 7
        stage('Monitoring') {
            steps {
                script {
                    // Optional: email alerts if the 'alert-email' credential exists
                    try {
                        withCredentials([usernamePassword(credentialsId: 'alert-email',
                                usernameVariable: 'ALERT_FROM', passwordVariable: 'ALERT_PASS')]) {
                            sh '''
                                cd monitoring/alertmanager
                                sed -e "s|ALERT_EMAIL_TO|$ALERT_FROM|" \
                                    -e "s|ALERT_EMAIL_FROM|$ALERT_FROM|g" \
                                    -e "s|ALERT_EMAIL_PASS|$ALERT_PASS|" \
                                    alertmanager.email.tmpl.yml > alertmanager.yml
                            '''
                            echo 'Alertmanager configured to email the team.'
                        }
                    } catch (err) {
                        echo 'No alert-email credential: alerts visible in Alertmanager UI only.'
                    }
                }
                sh '''
                    cd monitoring
                    docker compose -p mmm-monitoring -f docker-compose.monitoring.yml up -d --build

                    # Prometheus is up and has loaded the alert rules
                    for i in $(seq 1 20); do
                      curl -fs http://mmm-prometheus:9090/-/ready && break; sleep 3
                    done
                    curl -fs http://mmm-prometheus:9090/api/v1/rules | grep -q MMMProductionDown

                    # Prometheus can actually scrape production (up == 1)
                    for i in $(seq 1 20); do
                      if curl -fs 'http://mmm-prometheus:9090/api/v1/query?query=up%7Benv%3D%22production%22%7D' \
                           | grep -q '"1"\\]'; then
                        echo "Prometheus is scraping production: up=1"; ok=1; break
                      fi
                      echo "waiting for first scrape... ($i)"; sleep 3
                    done
                    [ "$ok" = "1" ]

                    curl -fs http://mmm-grafana:3000/api/health
                '''
                echo '''
Monitoring live:
  Grafana dashboard : http://localhost:3300  (MMM Art Studio > Production)
  Prometheus alerts : http://localhost:9090/alerts
  Alertmanager      : http://localhost:9093
Incident simulation : docker stop mmm-production   (MMMProductionDown fires after ~30s)
'''
            }
        }
    }

    post {
        success {
            echo "SUCCESS: v${VERSION} (${env.GIT_SHA}) built, tested, scanned, deployed, released and monitored."
        }
        failure {
            echo "FAILED at build #${env.BUILD_NUMBER}. Check the red stage above."
        }
        cleanup {
            sh 'rm -f ${IMAGE}-*.tar.gz || true'   // artefact already archived in Jenkins
        }
    }
}

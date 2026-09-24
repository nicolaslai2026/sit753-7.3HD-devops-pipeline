# Custom Jenkins image with everything the MMM pipeline needs baked in
# (infrastructure-as-code instead of installing tools by hand inside the container).
FROM jenkins/jenkins:lts-jdk21
USER root

# Docker CLI + Compose + Buildx (talks to Docker Desktop through the mounted socket)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin

# Node.js 24 (node:sqlite needs >= 22.13)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Trivy security scanner
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Jenkins plugins used by the Jenkinsfile
RUN jenkins-plugin-cli --plugins \
      workflow-aggregator git pipeline-stage-view timestamper junit \
      sonar credentials-binding email-ext ws-cleanup

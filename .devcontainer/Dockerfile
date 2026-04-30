FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv libsndfile1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
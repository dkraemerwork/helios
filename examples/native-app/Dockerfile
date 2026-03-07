FROM oven/bun:1

# Install nats-server binary from official NATS releases
ARG NATS_VERSION=2.10.24
RUN apt-get update && apt-get install -y curl unzip && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then NATS_ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then NATS_ARCH="arm64"; \
    else echo "Unsupported arch: $ARCH" && exit 1; fi && \
    curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}/nats-server-v${NATS_VERSION}-linux-${NATS_ARCH}.zip" -o /tmp/nats.zip && \
    unzip /tmp/nats.zip -d /tmp/nats && \
    cp /tmp/nats/nats-server-v${NATS_VERSION}-linux-${NATS_ARCH}/nats-server /usr/local/bin/nats-server && \
    chmod +x /usr/local/bin/nats-server && \
    rm -rf /tmp/nats /tmp/nats.zip && \
    apt-get purge -y unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY scatter ./scatter
COPY helios ./helios

WORKDIR /app/helios

CMD ["bun", "run", "examples/native-app/src/app.ts"]

FROM oven/bun:1

WORKDIR /app

COPY scatter ./scatter
COPY helios ./helios

WORKDIR /app/helios

CMD ["bun", "run", "examples/native-app/src/app.ts"]

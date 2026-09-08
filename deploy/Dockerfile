# Build from the repository root: docker build -f deploy/Dockerfile --target panel .
FROM golang:1.26 AS engines
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/xtls/xray-core/main@5ca6f4b7d4dc20a881d4330e498892697627ec0c && mv /out/main /out/xray
RUN go install -tags with_v2ray_api,with_utls,with_quic -ldflags '-X github.com/sagernet/sing-box/constant.Version=1.14.0' github.com/sagernet/sing-box/cmd/sing-box@v1.14.0
RUN go install github.com/go-acme/lego/v4/cmd/lego@v4.31.0
RUN curl -fsSL https://github.com/valkey-io/valkey/archive/5018b12b0de2d2322a1bbf6b041c43740587c0f2.tar.gz -o /tmp/valkey.tar.gz \
    && mkdir /tmp/valkey && tar -xzf /tmp/valkey.tar.gz --strip-components=1 -C /tmp/valkey \
    && make -C /tmp/valkey -j2 MALLOC=libc LDFLAGS=-static \
    && cp /tmp/valkey/src/valkey-server /out/valkey-server
COPY tools/pty /build-pty
RUN cd /build-pty && go build -trimpath -o /out/nodify-pty .

FROM node:24.20-trixie-slim AS build
WORKDIR /src
COPY . .
RUN npm run setup && npm run build
RUN node -e "require('fs').writeFileSync('/tmp/nodify-version.json',JSON.stringify({version:require('./package.json').version}))"

FROM build AS release
COPY --from=engines /out /release-engines
ENV NODIFY_ENGINE_DIR=/release-engines
RUN npm run release

FROM scratch AS release-artifacts
COPY --from=release /src/releases/*.tar.gz /
COPY --from=release /src/releases/SHA256SUMS /

FROM node:24.20-trixie-slim AS panel
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/app
COPY --from=build /src/apps/backend ./
COPY --from=build /src/apps/frontend/dist ./frontend
COPY --from=build /src/deploy ./deploy
COPY --from=build /tmp/nodify-version.json ./manifest.json
COPY --from=engines /out/lego /usr/local/bin/lego
ENV NODE_ENV=production NODIFY_DATA_DIR=/opt/app/data/nodify NODIFY_FRONTEND_DIR=/opt/app/frontend
EXPOSE 3000
ENTRYPOINT ["node", "deploy/panel-supervisor.mjs"]

FROM node:24.20-trixie-slim AS agent
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates nginx-light tini && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/nodify-agent
COPY --from=build /src/apps/node/agent ./agent
COPY --from=build /tmp/nodify-version.json ./manifest.json
COPY --from=build /src/apps/node/node_modules/ws ./node_modules/ws
COPY --from=engines /out/xray /usr/local/bin/xray
COPY --from=engines /out/sing-box /usr/local/bin/sing-box
COPY --from=engines /out/nodify-pty /usr/local/bin/nodify-pty
COPY tools/pty/LICENSE /usr/share/licenses/nodify-pty/LICENSE
ENV NODE_ENV=production NODIFY_AGENT_DATA=/var/lib/nodify-agent
ENTRYPOINT ["/usr/bin/tini", "--", "node", "agent/supervisor.mjs"]

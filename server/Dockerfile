FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /memedb-api ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=build /memedb-api /memedb-api
EXPOSE 8080
ENTRYPOINT ["/memedb-api", "-config", "/etc/memedb/config.yaml"]

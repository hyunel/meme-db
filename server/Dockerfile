FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /memedb ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=build /memedb /usr/local/bin/memedb
# Where config.yaml is read from, so commands run in the container find it too: docker compose exec server memedb backup ...
WORKDIR /etc/memedb
EXPOSE 8080
ENTRYPOINT ["memedb"]
CMD ["serve"]

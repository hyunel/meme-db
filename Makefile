# Makefile
.PHONY: gen-proto dev-all dev-web dev-server dev-ai

PROTO_DIR = protos
PROTO_SERVER_OUT = server/internal/pb
PROTO_INFERENCE_OUT = inference

gen-proto:
	rm -rf $(PROTO_SERVER_OUT)/*
	rm -rf $(PROTO_INFERENCE_OUT)/app/pb/*
	mkdir -p $(PROTO_SERVER_OUT)
	mkdir -p $(PROTO_INFERENCE_OUT)/app/pb

	protoc \
		--proto_path=$(PROTO_DIR) \
		--go_out=$(PROTO_SERVER_OUT) \
		--go_opt=paths=source_relative \
		--go-grpc_out=$(PROTO_SERVER_OUT) \
		--go-grpc_opt=paths=source_relative \
		$(PROTO_DIR)/*.proto

	python-grpc-tools-protoc \
		-Iapp/pb=$(PROTO_DIR) \
		--python_out=$(PROTO_INFERENCE_OUT) \
		--grpc_python_out=$(PROTO_INFERENCE_OUT) \
		$(PROTO_DIR)/*.proto

dev-all:
	docker-compose up -d

dev-web:
	cd web && bun dev

dev-server:
	cd server && go run cmd/api/main.go

dev-ai:
	cd inference && sh start.sh

build-all:
	docker-compose build
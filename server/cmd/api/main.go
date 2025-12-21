package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/handler"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/logger"
	"github.com/hyunel/MemeDB/internal/pkg/validator"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/hyunel/MemeDB/internal/worker"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	logger.Setup()

	// 1. Load Config
	cfg := config.LoadConfig("config.yaml")

	// 2. Connect DB
	pool, err := db.NewDB(cfg.Database.URL)
	if err != nil {
		slog.Error("Failed to connect to DB", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// 3. Setup Repositories (Provider)
	repo := repository.NewProvider(pool)

	// 4. Setup External Clients
	// vlmClient := service.NewVLMClient(&cfg.VLM)
	inferClient, err := inference.NewClient(cfg.Inference.GRPCAddr)
	if err != nil {
		slog.Error("Fatal to create inference client", "error", err)
		os.Exit(1)
	}
	defer inferClient.Close()

	// 5. Setup Services
	authService := service.NewAuthService(cfg, repo)
	memeService := service.NewMemeService(cfg, repo, inferClient)
	tagService := service.NewTagService(repo)
	assetService := service.NewAssetService(cfg)
	fsService := service.NewFileSystemService(repo, memeService, assetService)

	// 6. Setup Task Worker
	taskWorker, err := worker.NewWorker(cfg, repo)
	if err != nil {
		slog.Error("Failed to initialize worker", "error", err)
		os.Exit(1)
	}

	processMemesTask := worker.NewProcessMemesHandler(cfg, repo, inferClient)
	taskWorker.RegisterHandler(model.JobProcessMemes, processMemesTask)

	go taskWorker.Start(context.Background())

	// 7. Setup Handlers
	authHandler := handler.NewAuthHandler(authService)
	memeHandler := handler.NewMemeHandler(memeService)
	tagHandler := handler.NewTagHandler(tagService)
	fsHandler := handler.NewFileSystemHandler(fsService)
	assetHandler := handler.NewAssetHandler(cfg, fsService)

	// 8. Setup Echo
	e := echo.New()
	e.Validator = validator.New()
	e.HidePort = true
	e.HideBanner = true
	e.HTTPErrorHandler = handler.HTTPErrorHandler
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus:   true,
		LogURI:      true,
		LogMethod:   true,
		LogError:    true,
		HandleError: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			if v.Error != nil {
				slog.Error("Request error", "method", v.Method, "uri", v.URI, "status", v.Status, "error", v.Error)
			} else {
				slog.Info("Request", "method", v.Method, "uri", v.URI, "status", v.Status)
			}
			return nil
		},
	}))
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	// Public Routes
	e.POST("/api/auth/register", authHandler.Register)
	e.POST("/api/auth/login", authHandler.Login)
	e.GET("/api/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Asset access (Token based, can be accessed without AuthMiddleware if token is valid)
	e.GET("/api/assets/:id", assetHandler.GetAssetContent)

	// Protected Routes
	api := e.Group("/api")
	api.Use(authHandler.AuthMiddleware)

	api.GET("/auth/me", authHandler.GetMe)

	// FileSystem
	api.POST("/fs/nodes", fsHandler.CreateNode)
	api.GET("/fs/nodes", fsHandler.GetNode) // List root
	api.GET("/fs/nodes/:id", fsHandler.GetNode)
	api.PATCH("/fs/nodes/:id", fsHandler.UpdateNode)
	api.DELETE("/fs/nodes", fsHandler.BulkDelete)
	api.POST("/fs/nodes/move", fsHandler.BulkMove)
	api.POST("/fs/nodes/copy", fsHandler.BulkCopy)
	api.POST("/fs/upload", fsHandler.UploadMeme)

	// Tags
	api.GET("/tags", tagHandler.ListTags)
	api.POST("/tags", tagHandler.CreateTag)
	api.PUT("/tags/:id", tagHandler.UpdateTag)
	api.DELETE("/tags/:id", tagHandler.DeleteTag)
	api.POST("/fs/nodes/:nodeId/tags", tagHandler.AddTagToNode)
	api.DELETE("/fs/nodes/:nodeId/tags/:tagId", tagHandler.RemoveTagFromNode)

	api.GET("/search", memeHandler.Search)

	// Start Server
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	slog.Info("Starting server", "addr", addr)
	if err := e.Start(addr); err != nil {
		slog.Error("Server failed", "error", err)
	}
}

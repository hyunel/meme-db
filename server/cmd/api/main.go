package main

import (
	"context"
	"flag"
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
	configPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Parse()

	logger.Setup()

	// 1. Load Config
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

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
	inferClient, err := inference.NewClient(cfg.Inference.GRPCAddr)
	if err != nil {
		slog.Error("Failed to create inference client", "error", err)
		os.Exit(1)
	}
	defer inferClient.Close()

	// 5. Setup Services
	authService := service.NewAuthService(cfg, repo)
	assetService := service.NewAssetService(cfg, repo)
	memeService := service.NewMemeService(cfg, repo, assetService, inferClient)
	fsService := service.NewFileSystemService(repo, memeService, assetService)
	favService := service.NewFavoriteService(repo, memeService, assetService)
	tagService := service.NewTagService(repo, memeService)

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
	memeHandler := handler.NewMemeHandler(memeService, assetService, fsService)
	fsHandler := handler.NewFileSystemHandler(fsService)
	assetHandler := handler.NewAssetHandler(cfg, fsService)
	favHandler := handler.NewFavoriteHandler(favService)
	tagHandler := handler.NewTagHandler(tagService)

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
	e.Use(authHandler.IdentifyMiddleware)

	api := e.Group("/api")
	api.Use(authHandler.AuthMiddleware)

	// 9. Setup Routes
	e.GET("/api/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	e.GET("/api/search", memeHandler.Search)

	// Auth
	e.POST("/api/auth/register", authHandler.Register)
	e.POST("/api/auth/login", authHandler.Login)
	api.GET("/auth/me", authHandler.GetMe)

	// Meme
	e.GET("/api/memes/:id", memeHandler.GetMeme)
	api.POST("/memes/retry", memeHandler.BatchRetry)
	api.POST("/memes/:id/add", memeHandler.Add)

	// Asset
	e.GET("/api/assets/:id", assetHandler.GetAssetContent)

	// FileSystem
	api.POST("/fs/nodes", fsHandler.CreateNode)
	api.GET("/fs/nodes", fsHandler.GetNode) // List root
	api.GET("/fs/nodes/:id", fsHandler.GetNode)
	api.PATCH("/fs/nodes/:id", fsHandler.UpdateNode)
	api.DELETE("/fs/nodes", fsHandler.BulkDelete)
	api.POST("/fs/nodes/move", fsHandler.BulkMove)
	api.POST("/fs/nodes/copy", fsHandler.BulkCopy)
	api.POST("/fs/upload", fsHandler.UploadMeme)

	// Favorites
	api.GET("/favorites", favHandler.List)
	api.POST("/favorites", favHandler.Toggle)

	// Tags
	e.GET("/api/tags/search", tagHandler.SearchTags)
	e.GET("/api/tags/:id", tagHandler.GetTagMemes)
	e.GET("/api/memes/:id/tags", tagHandler.GetMemeTags)
	api.POST("/memes/:id/tags", tagHandler.AddTag)
	api.DELETE("/memes/:id/tags/:tag_id", tagHandler.RemoveTag)

	// Start Server
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	slog.Info("Starting server", "addr", addr)
	if err := e.Start(addr); err != nil {
		slog.Error("Server failed", "error", err)
	}
}

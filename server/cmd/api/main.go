package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/handler"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/logger"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

	// 5. Setup Task Worker & Services
	taskWorker := worker.NewWorker(cfg.Worker, repo.Task)

	authService := service.NewAuthService(service.AuthServiceConfig{
		JWTSecret: cfg.Server.JWTSecret,
	}, repo)

	assetService := service.NewAssetService(service.AssetServiceConfig{
		StoragePath:  cfg.Server.StoragePath,
		JWTSecret:    cfg.Server.JWTSecret,
		MaxSizeMB:    cfg.Upload.MaxSizeMB,
		AllowedTypes: cfg.Upload.AllowedTypes,
	}, repo, taskWorker)

	memeService := service.NewMemeService(service.MemeServiceConfig{
		RetrievalPrompt: cfg.Prompt.Retrieval,
	}, repo, assetService, inferClient.WithPriority(inference.PriorityInteractive), taskWorker)

	ingestService := service.NewIngestService(service.IngestServiceConfig{
		StoragePath:     cfg.Server.StoragePath,
		CaptionPrompt:   cfg.Prompt.Caption,
		RetrievalPrompt: cfg.Prompt.Retrieval,
	}, repo, inferClient.WithPriority(inference.PriorityBackground))

	fsService := service.NewFileSystemService(repo, memeService, assetService)
	favService := service.NewFavoriteService(repo, memeService, assetService)
	tagService := service.NewTagService(repo, memeService)

	// 6. Start Task Worker
	taskWorker.RegisterHandler(model.JobAnalyzeMeme, ingestService)

	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		taskWorker.Run(ctx)
	}()

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

	// Global identity middleware - sets identity for all requests
	e.Use(rbac.IdentityMiddleware(authHandler.IdentityProvider()))

	// 9. Setup Routes
	setupRoutes(e, authHandler, memeHandler, fsHandler, assetHandler, favHandler, tagHandler)

	// Start Server
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	go func() {
		slog.Info("Starting server", "addr", addr)
		if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("Server failed", "error", err)
			stop()
		}
	}()

	// Graceful shutdown: stop HTTP first, then let the worker release in-flight tasks
	// before the deferred inference client and DB pool closes run.
	<-ctx.Done()
	slog.Info("Shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server shutdown failed", "error", err)
	}
	<-workerDone
}

func setupRoutes(
	e *echo.Echo,
	auth *handler.AuthHandler,
	meme *handler.MemeHandler,
	fs *handler.FileSystemHandler,
	asset *handler.AssetHandler,
	fav *handler.FavoriteHandler,
	tag *handler.TagHandler,
) {
	api := e.Group("/api")

	// Health
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Auth (public)
	api.POST("/auth/register", auth.Register)
	api.POST("/auth/login", auth.Login)
	api.GET("/auth/me", auth.GetMe, rbac.RequireAuth())

	// ===== Public Routes (guest readable) =====
	api.POST("/search", meme.Search)
	api.GET("/assets/:id", asset.GetAssetContent)

	// Memes
	api.GET("/memes/:id", meme.GetMeme)
	api.GET("/memes/:id/similar", meme.GetSimilar)
	api.GET("/memes/:id/tags", tag.GetMemeTags)

	// Tags
	api.GET("/tags", tag.SearchTags)
	api.GET("/tags/:id/memes", tag.GetTagMemes)

	// ===== Protected Routes (authenticated) =====
	priv := api.Group("", rbac.RequireAuth())

	// Meme operations
	priv.POST("/memes/retry", meme.BatchRetry)
	priv.POST("/memes/:id/save", meme.Add)
	priv.POST("/memes/:id/tags", tag.AddTag)
	priv.DELETE("/memes/:id/tags/:tagId", tag.RemoveTag)

	// Library (FileSystem)
	lib := priv.Group("/library")
	lib.GET("", fs.GetNode)
	lib.GET("/:id", fs.GetNode)
	lib.POST("/folders", fs.CreateNode)
	lib.POST("/upload", fs.UploadMeme)
	lib.PATCH("/nodes", fs.BulkUpdateNodes)
	lib.DELETE("/nodes", fs.BulkDelete)
	lib.POST("/nodes/move", fs.BulkMove)
	lib.POST("/nodes/copy", fs.BulkCopy)

	// Favorites
	priv.GET("/favorites", fav.List)
	priv.POST("/favorites", fav.Toggle)
}

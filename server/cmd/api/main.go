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
	"strings"
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

	logEntries := logger.Setup()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewDB(cfg.Database.URL)
	if err != nil {
		slog.Error("Failed to connect to DB", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.NewProvider(pool)

	inferClient, err := inference.NewClient(cfg.Inference.GRPCAddr)
	if err != nil {
		slog.Error("Failed to create inference client", "error", err)
		os.Exit(1)
	}
	defer inferClient.Close()

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

	limits := cfg.Search.RecallLimits
	memeService := service.NewMemeService(service.MemeServiceConfig{
		RetrievalPrompt: cfg.Prompt.Retrieval,
		TagMinUsage:     cfg.Tags.MinUsage,
		SearchPages:     cfg.Search.MaxPages,
		SearchSessions:  cfg.Search.MaxSessions,
		SessionTTL:      cfg.Search.SessionTTL,
		RecallLimits:    map[string]int{"metaphor": limits.Metaphor, "semantic": limits.Semantic, "clip_text": limits.ClipText, "ocr": limits.OCR, "clip_image": limits.ClipImage},
		SimilarPages:    cfg.Similar.MaxPages,
		SimilarLimit:    cfg.Similar.RecallLimit,
	}, repo, assetService, inferClient.WithPriority(inference.PriorityInteractive), taskWorker)

	tagService := service.NewTagService(service.TagServiceConfig{
		Prompt:            cfg.Prompt.Tag,
		MergeSimilarity:   cfg.Tags.MergeSimilarity,
		SuggestSimilarity: cfg.Tags.SuggestSimilarity,
		MinUsage:          cfg.Tags.MinUsage,
		CommonShare:       cfg.Tags.CommonShare,
	}, repo, memeService, inferClient.WithPriority(inference.PriorityInteractive))

	ingestService := service.NewIngestService(service.IngestServiceConfig{
		StoragePath:     cfg.Server.StoragePath,
		CaptionPrompt:   strings.ReplaceAll(cfg.Prompt.Caption, "{language}", cfg.Prompt.Language),
		RetrievalPrompt: cfg.Prompt.Retrieval,
	}, repo, inferClient.WithPriority(inference.PriorityBackground), tagService)

	libraryService := service.NewLibraryService(repo, memeService, assetService, tagService)
	favService := service.NewFavoriteService(repo, memeService, libraryService)
	shareService := service.NewShareService(repo, memeService, libraryService)
	userService := service.NewUserService(repo, memeService)
	taskService := service.NewTaskService(repo, taskWorker)
	statsService := service.NewStatsService(repo, inferClient, cfg.Server.StoragePath)
	logService := service.NewLogService(repo, cfg.Log.Retention)

	taskWorker.RegisterHandler(model.JobAnalyzeMeme, ingestService)
	taskWorker.RegisterHandler(model.JobEmbedClip, worker.HandlerFunc(ingestService.EmbedClip))
	taskWorker.RegisterHandler(model.JobEmbedText, worker.HandlerFunc(ingestService.EmbedText))

	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		taskWorker.Run(ctx)
	}()

	// Stores logs, including those of the startup so far; it stops last, after shutdown.
	logCtx, stopLogs := context.WithCancel(context.Background())
	logsDone := make(chan struct{})
	go func() {
		defer close(logsDone)
		logService.Run(logCtx, logEntries)
	}()

	h := handlers{
		auth:     handler.NewAuthHandler(authService, userService),
		asset:    handler.NewAssetHandler(assetService),
		meme:     handler.NewMemeHandler(memeService, tagService),
		library:  handler.NewLibraryHandler(libraryService),
		share:    handler.NewShareHandler(shareService),
		favorite: handler.NewFavoriteHandler(favService),
		admin:    handler.NewAdminHandler(userService, memeService, tagService, statsService, logService),
		task:     handler.NewTaskHandler(taskService),
	}

	e := echo.New()
	e.Validator = validator.New()
	e.HidePort = true
	e.HideBanner = true
	e.HTTPErrorHandler = handler.HTTPErrorHandler
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		// Pages that poll; logging their requests would bury everything else (and feed the log viewer its own traffic).
		Skipper:     func(c echo.Context) bool { return c.Path() == "/api/admin/logs" || c.Path() == "/api/admin/inference" },
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

	e.Use(rbac.IdentityMiddleware(authService))

	setupRoutes(e, h)

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	go func() {
		slog.Info("Starting server", "addr", addr)
		if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("Server failed", "error", err)
			stop()
		}
	}()

	// Stop HTTP, then the worker (releasing in-flight tasks), then the log writer; deferred closes run last.
	<-ctx.Done()
	slog.Info("Shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server shutdown failed", "error", err)
	}
	<-workerDone
	stopLogs()
	<-logsDone
}

type handlers struct {
	auth     *handler.AuthHandler
	asset    *handler.AssetHandler
	meme     *handler.MemeHandler
	library  *handler.LibraryHandler
	share    *handler.ShareHandler
	favorite *handler.FavoriteHandler
	admin    *handler.AdminHandler
	task     *handler.TaskHandler
}

func setupRoutes(e *echo.Echo, h handlers) {
	api := e.Group("/api")

	// Guest-readable
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	api.GET("/config", h.asset.GetConfig)
	api.GET("/stats", h.meme.Stats)
	api.GET("/assets/:id", h.asset.GetAssetContent)
	api.HEAD("/assets/:id", h.asset.GetAssetContent) // Its ETag, the SHA-256 of the file, tells clients what they already uploaded

	api.POST("/auth/register", h.auth.Register)
	api.POST("/auth/login", h.auth.Login)

	api.POST("/search", h.meme.Search)
	api.GET("/search", h.meme.SearchPage)
	api.GET("/memes", h.meme.List)
	api.GET("/memes/:id", h.meme.Get)
	api.GET("/memes/:id/similar", h.meme.Similar)
	api.GET("/memes/:id/folders", h.library.MemeFolders)
	api.POST("/memes/:id/share/views", h.share.View)
	api.GET("/tags/hot", h.meme.HotTags)
	api.GET("/folders", h.library.PublicFolders)
	api.GET("/folders/:id", h.library.PublicFolder)
	api.GET("/folders/:id/entries", h.library.FolderEntries)
	api.POST("/folders/:id/share/views", h.share.View)
	api.GET("/entries/:id", h.library.Entry)
	api.GET("/users/:username", h.library.Profile)
	api.GET("/users/:username/memes", h.library.ProfileMemes)

	// Signed-in users; read-scoped API tokens may only read
	priv := api.Group("", rbac.RequireAuth())

	priv.GET("/auth/me", h.auth.GetMe)
	priv.GET("/auth/me/stats", h.auth.GetMyStats)

	session := priv.Group("/auth", rbac.RequireSession())
	session.PUT("/password", h.auth.ChangePassword)
	session.GET("/tokens", h.auth.ListTokens)
	session.POST("/tokens", h.auth.CreateToken)
	session.DELETE("/tokens/:id", h.auth.DeleteToken)

	priv.POST("/memes/:id/retry", h.meme.Retry)
	priv.GET("/shares", h.share.List)
	priv.GET("/memes/:id/share", h.share.Get)
	priv.PUT("/memes/:id/share", h.share.CreateMemeLink)
	priv.DELETE("/memes/:id/share", h.share.Delete)
	priv.GET("/folders/:id/share", h.share.Get)
	priv.PUT("/folders/:id/share", h.share.CreateFolderLink)
	priv.DELETE("/folders/:id/share", h.share.Delete)
	priv.POST("/memes/:id/tags", h.meme.AddTag)
	priv.DELETE("/memes/:id/tags/:tagId", h.meme.RemoveTag)

	priv.GET("/favorites", h.favorite.List)
	priv.GET("/favorites/memes", h.favorite.Memes)
	priv.DELETE("/favorites/stale", h.favorite.ClearStale)
	priv.PUT("/favorites/:kind/:id", h.favorite.Add)
	priv.DELETE("/favorites/:kind/:id", h.favorite.Remove)

	lib := priv.Group("/library")
	lib.GET("", h.library.Get)
	lib.GET("/folders", h.library.FolderTree)
	lib.POST("/folders", h.library.CreateFolder)
	lib.POST("/folders/:id/save", h.library.SaveFolder)
	lib.POST("/upload", h.library.Upload)
	lib.POST("/entries", h.library.AddEntry)
	lib.PATCH("/nodes", h.library.SetPublic)
	lib.PATCH("/nodes/:id", h.library.Rename)
	lib.DELETE("/nodes", h.library.Delete)
	lib.POST("/nodes/move", h.library.Move)
	lib.POST("/nodes/copy", h.library.Copy)

	// Admins; API tokens need the admin scope
	admin := priv.Group("/admin", rbac.RequireAdmin())

	admin.GET("/stats", h.admin.Stats)
	admin.GET("/logs", h.admin.Logs)
	admin.GET("/inference", h.admin.InferenceMetrics)

	admin.GET("/users", h.admin.ListUsers)
	admin.POST("/users", h.admin.CreateUser)
	admin.GET("/users/:id", h.admin.GetUser)
	admin.PATCH("/users/:id", h.admin.UpdateUser)
	admin.PUT("/users/:id/password", h.admin.ResetPassword)
	admin.DELETE("/users/:id", h.admin.DeleteUser)

	admin.GET("/memes", h.admin.ListMemes)
	admin.POST("/memes/reprocess", h.admin.ReprocessMemes)
	admin.DELETE("/memes", h.admin.DeleteMemes)
	admin.POST("/search/debug", h.admin.SearchDebug)

	admin.GET("/tags", h.admin.ListTags)
	admin.GET("/tags/duplicates", h.admin.TagDuplicates)
	admin.POST("/tags/merge", h.admin.MergeTags)
	admin.PATCH("/tags/:id", h.admin.UpdateTag)
	admin.DELETE("/tags", h.admin.DeleteTags)

	admin.GET("/tasks", h.task.List)
	admin.GET("/tasks/summary", h.task.Summary)
	admin.GET("/tasks/batches/:id", h.task.GetBatch)
	admin.POST("/tasks/batches/:id/cancel", h.task.CancelBatch)
	admin.GET("/tasks/:id", h.task.Get)
	admin.POST("/tasks/retry", h.task.Retry)
	admin.POST("/tasks/:id/run", h.task.RunNow)
	admin.POST("/tasks/:id/cancel", h.task.Cancel)
}

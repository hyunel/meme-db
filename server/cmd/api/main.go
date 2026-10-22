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
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/db"
	"github.com/hyunel/MemeDB/internal/handler"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/inference"
	"github.com/hyunel/MemeDB/internal/pkg/logger"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/pkg/storage"
	"github.com/hyunel/MemeDB/internal/pkg/validator"
	"github.com/hyunel/MemeDB/internal/repository"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/hyunel/MemeDB/internal/worker"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/term"
)

type command struct {
	usage string // Its words, then its arguments: "backup export <file>"
	about string
	run   func(ctx context.Context, a *app, args []string) error
}

var commands = []command{
	{"serve", "Serve the API, the database's schema brought up to date first", serve},
	{"backup export <file>", "Write the site's data and files to a zip, but for what a new site works out again", exportBackup},
	{"backup restore <file>", "Restore a backup into an empty database", restoreBackup},
	{"user list", "List the accounts", listUsers},
	{"user role <username> <admin|user>", "Make an account an admin or a user", setRole},
	{"user password <username>", "Set an account's password, signing it out everywhere", setPassword},
}

type app struct {
	cfg        *config.Config
	logEntries <-chan logger.Entry
	repo       *repository.Provider
	infer      *inference.Client
	worker     *worker.Worker
	files      storage.Storage
	assets     *service.AssetService
	memes      *service.MemeService
	users      *service.UserService
	backups    *service.BackupService
}

func main() {
	configPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Usage = usage
	flag.Parse()
	cmd, args := lookup(flag.Args())
	if cmd == nil {
		flag.Usage()
		os.Exit(2)
	}

	logEntries := logger.Setup()
	if err := run(*configPath, logEntries, cmd, args); err != nil {
		slog.Error("Command failed", "error", err)
		os.Exit(1)
	}
}

func run(configPath string, logEntries <-chan logger.Entry, cmd *command, args []string) error {
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		return err
	}

	pool, err := db.NewDB(cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()

	repo := repository.NewProvider(pool)

	inferClient, err := inference.NewClient(cfg.Inference.GRPCAddr)
	if err != nil {
		return err
	}
	defer inferClient.Close()

	taskWorker := worker.NewWorker(cfg.Worker, repo.Task)

	files := storage.New(cfg.Storage)

	assetService := service.NewAssetService(service.AssetServiceConfig{
		MaxSizeMB:    cfg.Upload.MaxSizeMB,
		AllowedTypes: cfg.Upload.AllowedTypes,
	}, repo, files, taskWorker)

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

	return cmd.run(context.Background(), &app{
		cfg:        cfg,
		logEntries: logEntries,
		repo:       repo,
		infer:      inferClient,
		worker:     taskWorker,
		files:      files,
		assets:     assetService,
		memes:      memeService,
		users:      service.NewUserService(repo, memeService),
		backups:    service.NewBackupService(repo, files, assetService),
	}, args)
}

func serve(ctx context.Context, a *app, _ []string) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := a.repo.Migrate(ctx, db.LatestVersion); err != nil {
		return fmt.Errorf("failed to migrate the database: %w", err)
	}

	cfg, repo, taskWorker := a.cfg, a.repo, a.worker

	authService := service.NewAuthService(service.AuthServiceConfig{
		SessionTTL: cfg.Auth.SessionTTL,
	}, repo)

	tagService := service.NewTagService(service.TagServiceConfig{
		Prompt:            cfg.Prompt.Tag,
		MergeSimilarity:   cfg.Tags.MergeSimilarity,
		SuggestSimilarity: cfg.Tags.SuggestSimilarity,
		MinUsage:          cfg.Tags.MinUsage,
		CommonShare:       cfg.Tags.CommonShare,
	}, repo, a.memes, a.infer.WithPriority(inference.PriorityInteractive))

	ingestService := service.NewIngestService(service.IngestServiceConfig{
		CaptionPrompt:   strings.ReplaceAll(cfg.Prompt.Caption, "{language}", cfg.Prompt.Language),
		RetrievalPrompt: cfg.Prompt.Retrieval,
	}, repo, a.files, a.infer.WithPriority(inference.PriorityBackground), tagService)

	libraryService := service.NewLibraryService(repo, a.memes, a.assets, tagService)
	favService := service.NewFavoriteService(repo, a.memes, libraryService)
	shareService := service.NewShareService(repo, a.memes, libraryService)
	taskService := service.NewTaskService(repo, taskWorker)
	statsService := service.NewStatsService(repo, a.infer, a.files)
	logService := service.NewLogService(repo)
	embeddingService := service.NewEmbeddingService(repo, a.infer.WithPriority(inference.PriorityBackground))

	taskWorker.RegisterHandler(model.JobAnalyzeMeme, ingestService)
	taskWorker.RegisterHandler(model.JobEmbedClip, worker.HandlerFunc(ingestService.EmbedClip))
	taskWorker.RegisterHandler(model.JobEmbedText, worker.HandlerFunc(ingestService.EmbedText))
	taskWorker.RegisterHandler(model.JobEmbedMeme, worker.HandlerFunc(ingestService.EmbedMeme))
	taskWorker.RegisterHandler(model.JobRefreshTags, worker.HandlerFunc(tagService.Refresh))
	taskWorker.RegisterHandler(model.JobPurgeLogs, worker.HandlerFunc(logService.Purge))
	taskWorker.RegisterHandler(model.JobPurgeTasks, worker.HandlerFunc(taskService.Purge))
	if err := taskWorker.Schedule(cfg.Tasks); err != nil {
		return fmt.Errorf("failed to schedule the configured tasks: %w", err)
	}

	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		taskWorker.Run(ctx)
	}()
	go embeddingService.Run(ctx)

	// Stores logs, including those of the startup so far; it stops last, after shutdown.
	logCtx, stopLogs := context.WithCancel(context.Background())
	logsDone := make(chan struct{})
	go func() {
		defer close(logsDone)
		logService.Run(logCtx, a.logEntries)
	}()

	h := handlers{
		auth:     handler.NewAuthHandler(authService, a.users),
		asset:    handler.NewAssetHandler(a.assets),
		meme:     handler.NewMemeHandler(a.memes, tagService),
		library:  handler.NewLibraryHandler(libraryService),
		share:    handler.NewShareHandler(shareService),
		favorite: handler.NewFavoriteHandler(favService),
		admin:    handler.NewAdminHandler(a.users, a.memes, tagService, statsService, logService),
		task:     handler.NewTaskHandler(taskService),
	}

	e := echo.New()
	e.Validator = validator.New()
	e.HidePort = true
	e.HideBanner = true
	e.HTTPErrorHandler = handler.HTTPErrorHandler
	// Browsers come through the web's proxy, whose X-Forwarded-For is trusted from internal addresses only.
	e.IPExtractor = echo.ExtractIPFromXFFHeader()
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		// Pages that poll; logging their requests would bury everything else (and feed the log viewer its own traffic).
		Skipper:     func(c echo.Context) bool { return c.Path() == "/api/admin/logs" || c.Path() == "/api/admin/inference" },
		LogStatus:   true,
		LogURI:      true,
		LogMethod:   true,
		LogLatency:  true,
		LogRemoteIP: true,
		LogError:    true,
		HandleError: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			attrs := []any{"method", v.Method, "uri", v.URI, "status", v.Status, "latency_ms", v.Latency.Milliseconds(), "ip", v.RemoteIP}
			if id := rbac.GetIdentity(c); id != nil && id.UserID != "" { // Files are served without one
				attrs = append(attrs, "user_id", id.UserID)
			}
			if v.Error != nil {
				slog.Error("Request error", append(attrs, "error", v.Error)...)
			} else {
				slog.Info("Request", attrs...)
			}
			return nil
		},
	}))
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	setupRoutes(e, h, rbac.IdentityMiddleware(authService))

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
	return nil
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

func setupRoutes(e *echo.Echo, h handlers, identity echo.MiddlewareFunc) {
	// Files open by their hash links, so these skip finding out who asks, which every image would pay for.
	e.GET("/api/assets/:hash", h.asset.GetAssetContent)
	e.HEAD("/api/assets/:hash", h.asset.GetAssetContent) // Tells clients whether a file, by its SHA-256, is already stored

	api := e.Group("/api", identity)

	// Guest-readable
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	api.GET("/config", h.asset.GetConfig)
	api.GET("/stats", h.meme.Stats)

	api.POST("/auth/register", h.auth.Register)
	api.POST("/auth/login", h.auth.Login)
	api.POST("/auth/logout", h.auth.Logout)

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
	api.GET("/users/:username/folders", h.library.PublicFolders)
	api.GET("/users/:username/memes", h.library.ProfileMemes)

	// Signed-in users; read-scoped API tokens may only read
	priv := api.Group("", rbac.RequireAuth())

	priv.GET("/auth/me", h.auth.GetMe)
	priv.GET("/auth/me/stats", h.auth.GetMyStats)

	session := priv.Group("/auth", rbac.RequireSession())
	session.PUT("/password", h.auth.ChangePassword)
	session.GET("/sessions", h.auth.ListSessions)
	session.DELETE("/sessions", h.auth.DeleteSessions)
	session.DELETE("/sessions/:id", h.auth.DeleteSessions)
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
	admin.DELETE("/users/:id/sessions", h.admin.DeleteUserSessions)
	admin.DELETE("/users/:id/sessions/:sid", h.admin.DeleteUserSessions)
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
	admin.GET("/tasks/schedules", h.task.Schedules)
	admin.POST("/tasks/schedules/:name/run", h.task.RunSchedule)
	admin.GET("/tasks/batches/:id", h.task.GetBatch)
	admin.POST("/tasks/batches/:id/cancel", h.task.CancelBatch)
	admin.GET("/tasks/:id", h.task.Get)
	admin.POST("/tasks/retry", h.task.Retry)
	admin.POST("/tasks/:id/run", h.task.RunNow)
	admin.POST("/tasks/:id/cancel", h.task.Cancel)
}

func usage() {
	out := flag.CommandLine.Output()
	fmt.Fprintf(out, "Usage: %s [-config path] <command>\n\nCommands:\n", filepath.Base(os.Args[0]))
	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	for _, c := range commands {
		fmt.Fprintf(w, "  %s\t%s\n", c.usage, c.about)
	}
	w.Flush()
	fmt.Fprintln(out, "\nFlags:")
	flag.PrintDefaults()
}

func lookup(args []string) (*command, []string) {
	for i, c := range commands {
		words := strings.Fields(c.usage)
		n := slices.IndexFunc(words, func(w string) bool { return strings.HasPrefix(w, "<") })
		if n < 0 {
			n = len(words)
		}
		if len(args) == len(words) && slices.Equal(args[:n], words[:n]) {
			return &commands[i], args[n:]
		}
	}
	return nil, nil
}

func exportBackup(ctx context.Context, a *app, args []string) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM) // Stopped, it removes the unfinished file
	defer stop()
	path := args[0]
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	stats, err := a.backups.Export(ctx, f)
	if err = errors.Join(err, f.Close()); err != nil {
		os.Remove(path)
		return err
	}
	fmt.Printf("Exported %d users and %d memes, with %d files (%.1f MB), to %s\n",
		stats.Rows["iam.users"], stats.Rows["core.assets"], stats.Files, float64(stats.Bytes)/1e6, path)
	return nil
}

func restoreBackup(ctx context.Context, a *app, args []string) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM) // Stopped, it removes the files it stored
	defer stop()
	f, err := os.Open(args[0])
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	stats, err := a.backups.Restore(ctx, f, stat.Size())
	if err != nil {
		return err
	}
	fmt.Printf("Restored %d users and %d memes, with %d files (%.1f MB).\n",
		stats.Rows["iam.users"], stats.Rows["core.assets"], stats.Files, float64(stats.Bytes)/1e6)
	fmt.Println("Once serving, the server works out the embeddings again with its own models, without the VLM.")
	return nil
}

func listUsers(ctx context.Context, a *app, _ []string) error {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "USERNAME\tEMAIL\tROLE\tSTATUS\tJOINED")
	for page := (repository.Page{Limit: 100}); ; page.Offset += page.Limit {
		users, err := a.users.List(ctx, service.UserFilter{Sort: "oldest"}, page)
		if err != nil {
			return err
		}
		for _, u := range users.Items {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", u.Username, u.Email, u.Role, u.Status, u.CreatedAt.Format(time.DateOnly))
		}
		if page.Offset+page.Limit >= users.Total {
			return w.Flush()
		}
	}
}

// The command line acts for no account, as an admin would.
var operator = &rbac.Identity{Role: rbac.RoleAdmin}

func setRole(ctx context.Context, a *app, args []string) error {
	role := args[1]
	named, ok := map[string]string{rbac.RoleAdmin: "an admin", rbac.RoleUser: "a user"}[role]
	if !ok {
		return fmt.Errorf("the role is admin or user, not %q", role)
	}
	user, err := a.users.GetByUsername(ctx, args[0])
	if err != nil {
		return err
	}
	if err := a.users.Update(ctx, operator, user.ID, &role, nil); err != nil {
		return err
	}
	fmt.Printf("%s is now %s\n", user.Username, named)
	return nil
}

func setPassword(ctx context.Context, a *app, args []string) error {
	user, err := a.users.GetByUsername(ctx, args[0])
	if err != nil {
		return err
	}
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return errors.New("the password is typed at a terminal")
	}
	var typed []string
	for _, prompt := range []string{"New password: ", "Again: "} {
		fmt.Fprint(os.Stderr, prompt)
		password, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return err
		}
		typed = append(typed, string(password))
	}
	if typed[0] != typed[1] {
		return errors.New("the passwords differ")
	}
	if err := a.users.ResetPassword(ctx, operator, user.ID, typed[0]); err != nil {
		return err
	}
	fmt.Printf("Set the password of %s, who is signed out everywhere\n", user.Username)
	return nil
}

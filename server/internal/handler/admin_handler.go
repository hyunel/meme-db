package handler

import (
	"cmp"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/service"
	"github.com/labstack/echo/v4"
)

type AdminHandler struct {
	userService  *service.UserService
	memeService  *service.MemeService
	tagService   *service.TagService
	statsService *service.StatsService
	logService   *service.LogService
}

func NewAdminHandler(
	userService *service.UserService,
	memeService *service.MemeService,
	tagService *service.TagService,
	statsService *service.StatsService,
	logService *service.LogService,
) *AdminHandler {
	return &AdminHandler{
		userService:  userService,
		memeService:  memeService,
		tagService:   tagService,
		statsService: statsService,
		logService:   logService,
	}
}

type CountResponse struct {
	Count int `json:"count"`
}

type ListUsersRequest struct {
	PageQuery
	RangeQuery
	Query  string `query:"q" validate:"max=100"`
	Role   string `query:"role" validate:"omitempty,oneof=user admin"`
	Status string `query:"status" validate:"omitempty,oneof=active disabled"`
	Sort   string `query:"sort" validate:"omitempty,oneof=newest oldest name"`
}

func (h *AdminHandler) ListUsers(c echo.Context) error {
	var req ListUsersRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.userService.List(c.Request().Context(), service.UserFilter{
		Query:   strings.TrimSpace(req.Query),
		Role:    req.Role,
		Status:  req.Status,
		Created: req.timeRange(),
		Sort:    req.Sort,
	}, req.page())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

type UserRequest struct {
	ID string `param:"id" validate:"required,uuid"`
}

func (h *AdminHandler) GetUser(c echo.Context) error {
	var req UserRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	user, err := h.userService.Get(c.Request().Context(), rbac.GetIdentity(c), req.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, user)
}

type CreateUserRequest struct {
	RegisterRequest
	Role string `json:"role" validate:"required,oneof=user admin"`
}

func (h *AdminHandler) CreateUser(c echo.Context) error {
	var req CreateUserRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	user, err := h.userService.Create(c.Request().Context(), req.Username, req.Email, req.Password, req.Role)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, user)
}

type UpdateUserRequest struct {
	ID     string  `param:"id" validate:"required,uuid"`
	Role   *string `json:"role" validate:"omitempty,oneof=user admin"`
	Status *string `json:"status" validate:"omitempty,oneof=active disabled"`
}

func (h *AdminHandler) UpdateUser(c echo.Context) error {
	var req UpdateUserRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.userService.Update(c.Request().Context(), rbac.GetIdentity(c), req.ID, req.Role, req.Status); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type ResetPasswordRequest struct {
	ID       string `param:"id" validate:"required,uuid"`
	Password string `json:"password" validate:"required,min=6"`
}

func (h *AdminHandler) ResetPassword(c echo.Context) error {
	var req ResetPasswordRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.userService.ResetPassword(c.Request().Context(), req.ID, req.Password); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *AdminHandler) DeleteUser(c echo.Context) error {
	var req UserRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.userService.Delete(c.Request().Context(), rbac.GetIdentity(c), req.ID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type MemeFilterParams struct {
	RangeQuery
	Query      string `query:"q" json:"q" validate:"max=100"`
	Status     string `query:"status" json:"status" validate:"omitempty,oneof=pending processing success failed"`
	Visibility string `query:"visibility" json:"visibility" validate:"omitempty,oneof=public private"`
	Kind       string `query:"kind" json:"kind" validate:"omitempty,oneof=image gif video lottie"`
}

func (p MemeFilterParams) filter() service.MemeFilter {
	return service.MemeFilter{
		Query:      strings.TrimSpace(p.Query),
		Status:     p.Status,
		Visibility: p.Visibility,
		Kind:       p.Kind,
		Created:    p.timeRange(),
	}
}

type ListMemesAdminRequest struct {
	PageQuery
	MemeFilterParams
}

func (h *AdminHandler) ListMemes(c echo.Context) error {
	var req ListMemesAdminRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.memeService.List(c.Request().Context(), rbac.GetIdentity(c), req.filter(), req.page())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

type ReprocessMemesRequest struct {
	IDs    []string          `json:"ids" validate:"max=1000,dive,uuid"`
	Filter *MemeFilterParams `json:"filter"`
	Job    string            `json:"job" validate:"omitempty,oneof=analyze_meme embed_clip embed_text"` // Defaults to analyze_meme
}

type BatchResponse struct {
	Count   int    `json:"count"`
	BatchID string `json:"batch_id"`
}

func (h *AdminHandler) ReprocessMemes(c echo.Context) error {
	var req ReprocessMemesRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	job := cmp.Or(req.Job, model.JobAnalyzeMeme)
	var res BatchResponse
	var err error
	switch {
	case len(req.IDs) > 0:
		res.Count, res.BatchID, err = h.memeService.Rebuild(c.Request().Context(), job, req.IDs)
	case req.Filter != nil:
		if err := c.Validate(req.Filter); err != nil {
			return apperror.BadRequest("请求参数无效：" + err.Error())
		}
		res.Count, res.BatchID, err = h.memeService.RebuildMatching(c.Request().Context(), job, req.Filter.filter())
	default:
		return apperror.BadRequest("请指定要重新处理的表情包")
	}
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, res)
}

type IDsRequest struct {
	IDs []string `json:"ids" validate:"required,min=1,max=1000,dive,uuid"`
}

func (h *AdminHandler) DeleteMemes(c echo.Context) error {
	var req IDsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	n, err := h.memeService.Delete(c.Request().Context(), req.IDs)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, CountResponse{Count: n})
}

type SearchDebugRequest struct {
	Query string                `form:"q" validate:"max=200"`
	Image *multipart.FileHeader `form:"image"`
	Scope string                `form:"scope" validate:"omitempty,oneof=all public"`
	Track string                `form:"track" validate:"omitempty,uuid"`
	// Recall limits overriding the defaults
	Metaphor  int `form:"metaphor" validate:"omitempty,min=1,max=200"`
	Semantic  int `form:"semantic" validate:"omitempty,min=1,max=200"`
	ClipText  int `form:"clip_text" validate:"omitempty,min=1,max=200"`
	OCR       int `form:"ocr" validate:"omitempty,min=1,max=200"`
	ClipImage int `form:"clip_image" validate:"omitempty,min=1,max=200"`
}

func (h *AdminHandler) SearchDebug(c echo.Context) error {
	var req SearchDebugRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" && req.Image == nil {
		return apperror.BadRequest("请输入关键词或添加图片")
	}

	params := service.SearchDebugParams{Viewer: rbac.GetIdentity(c), Query: req.Query, Public: req.Scope == "public", Track: req.Track, Limits: map[string]int{}}
	for channel, limit := range map[string]int{"metaphor": req.Metaphor, "semantic": req.Semantic, "clip_text": req.ClipText, "ocr": req.OCR, "clip_image": req.ClipImage} {
		if limit > 0 {
			params.Limits[channel] = limit
		}
	}
	if req.Image != nil {
		image, err := readSearchImage(req.Image)
		if err != nil {
			return err
		}
		params.Image = image
	}

	debug, err := h.memeService.Debug(c.Request().Context(), params)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, debug)
}

type ListTagsRequest struct {
	PageQuery
	Query string `query:"q" validate:"max=100"`
	Sort  string `query:"sort" validate:"omitempty,oneof=usage name created"`
}

func (h *AdminHandler) ListTags(c echo.Context) error {
	var req ListTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	page, err := h.tagService.List(c.Request().Context(), strings.TrimSpace(req.Query), req.Sort, req.page())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, page)
}

func (h *AdminHandler) TagDuplicates(c echo.Context) error {
	groups, err := h.tagService.Duplicates(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, groups)
}

type UpdateTagRequest struct {
	ID     string  `param:"id" validate:"required,uuid"`
	Name   *string `json:"name"`
	Hidden *bool   `json:"hidden"`
}

func (h *AdminHandler) UpdateTag(c echo.Context) error {
	var req UpdateTagRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	ctx := c.Request().Context()

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len([]rune(name)) > 50 {
			return apperror.BadRequest("标签需为 1–50 个字符")
		}
		if err := h.tagService.Rename(ctx, req.ID, name); err != nil {
			return err
		}
	}
	if req.Hidden != nil {
		if err := h.tagService.SetHidden(ctx, req.ID, *req.Hidden); err != nil {
			return err
		}
	}
	return c.NoContent(http.StatusNoContent)
}

type MergeTagsRequest struct {
	SourceIDs []string `json:"source_ids" validate:"required,min=1,max=1000,dive,uuid"`
	TargetID  string   `json:"target_id" validate:"required,uuid"`
}

func (h *AdminHandler) MergeTags(c echo.Context) error {
	var req MergeTagsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.Merge(c.Request().Context(), req.SourceIDs, req.TargetID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *AdminHandler) DeleteTags(c echo.Context) error {
	var req IDsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.tagService.Delete(c.Request().Context(), req.IDs); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type InferenceMetricsRequest struct {
	Range string `query:"range" validate:"omitempty,oneof=15m 1h 6h 24h"`
}

func (h *AdminHandler) InferenceMetrics(c echo.Context) error {
	var req InferenceMetricsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}

	data, err := h.statsService.Inference(c.Request().Context(), cmp.Or(req.Range, "1h"))
	if err != nil {
		return err
	}
	return c.JSONBlob(http.StatusOK, data)
}

type StatsRequest struct {
	RangeQuery
	TimeZone string `query:"tz" validate:"max=64"` // IANA name for the daily trend buckets
}

func (h *AdminHandler) Stats(c echo.Context) error {
	var req StatsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	r := req.timeRange()
	if r.To.IsZero() {
		r.To = time.Now()
	}
	if r.From.IsZero() || r.From.After(r.To) {
		r.From = r.To.AddDate(0, 0, -7)
	}
	tz := "UTC"
	if _, err := time.LoadLocation(req.TimeZone); req.TimeZone != "" && err == nil {
		tz = req.TimeZone
	}

	overview, err := h.statsService.Overview(c.Request().Context(), r.From, r.To, tz)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, overview)
}

type LogsRequest struct {
	RangeQuery          // Only From applies
	After      int64    `query:"after" validate:"min=0"`
	Before     int64    `query:"before" validate:"min=0"`
	Limit      int      `query:"limit" validate:"omitempty,min=1,max=5000"`
	Level      string   `query:"level" validate:"omitempty,oneof=debug info warn error"`
	Query      string   `query:"q" validate:"max=200"`
	Attrs      []string `query:"attr" validate:"max=10"` // key=value
}

func (h *AdminHandler) Logs(c echo.Context) error {
	var req LogsRequest
	if err := BindAndValidate(c, &req); err != nil {
		return err
	}
	f := service.LogFilter{MinLevel: req.Level, Query: strings.TrimSpace(req.Query), Since: req.timeRange().From, Attrs: map[string]string{}}
	for _, a := range req.Attrs {
		k, v, ok := strings.Cut(a, "=")
		if !ok || k == "" {
			return apperror.BadRequest("信息条件需为 key=value 形式")
		}
		f.Attrs[k] = v
	}

	logs, err := h.logService.List(c.Request().Context(), f, req.After, req.Before, limitOr(req.Limit, 100))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, logs)
}

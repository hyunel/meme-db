package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

// Tells API tokens apart from session JWTs.
const tokenPrefix = "mdb_"

type AuthServiceConfig struct {
	JWTSecret string
}

type AuthService struct {
	cfg  AuthServiceConfig
	repo *repository.Provider
}

func NewAuthService(cfg AuthServiceConfig, repo *repository.Provider) *AuthService {
	return &AuthService{cfg: cfg, repo: repo}
}

type Claims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

func (s *AuthService) Register(ctx context.Context, username, email, password string) (string, *model.User, error) {
	user, err := createUser(ctx, s.repo, username, email, password, rbac.RoleUser)
	if err != nil {
		return "", nil, err
	}
	token, err := s.newSession(user.ID)
	return token, user, err
}

func (s *AuthService) Login(ctx context.Context, email, password string) (string, *model.User, error) {
	user, err := s.repo.User.GetByEmail(ctx, email)
	if err != nil {
		return "", nil, err
	}
	if user == nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return "", nil, apperror.Unauthorized("邮箱或密码错误")
	}
	if user.Status != model.UserStatusActive {
		return "", nil, apperror.Forbidden("该账号已被禁用，请联系管理员")
	}

	token, err := s.newSession(user.ID)
	return token, user, err
}

func (s *AuthService) GetUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.Unauthorized("用户不存在")
	}
	return user, nil
}

func (s *AuthService) ChangePassword(ctx context.Context, userID, current, next string) error {
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(current)) != nil {
		return apperror.BadRequest("当前密码不正确").OnField("current_password")
	}
	return setPassword(ctx, s.repo.Repos, userID, next)
}

// Authenticate rejects a bad API token, so that a script never silently runs as a guest,
// while a stale session degrades to a guest, which the web app notices through /auth/me.
func (s *AuthService) Authenticate(ctx context.Context, credential string) (*rbac.Identity, error) {
	if strings.HasPrefix(credential, tokenPrefix) {
		return s.tokenIdentity(ctx, credential)
	}

	guest := &rbac.Identity{Role: rbac.RoleGuest}
	userID, err := s.parseSession(credential)
	if err != nil {
		return guest, nil
	}
	user, err := s.activeUser(ctx, userID)
	if err != nil || user == nil {
		return guest, err
	}
	return &rbac.Identity{UserID: user.ID, Role: user.Role}, nil
}

var _ rbac.Authenticator = (*AuthService)(nil)

func (s *AuthService) tokenIdentity(ctx context.Context, secret string) (*rbac.Identity, error) {
	token, err := s.repo.Token.GetByHash(ctx, hashToken(secret))
	if err != nil {
		return nil, err
	}
	var user *model.User
	if token != nil && (token.ExpiresAt == nil || token.ExpiresAt.After(time.Now())) {
		if user, err = s.activeUser(ctx, token.UserID); err != nil {
			return nil, err
		}
	}
	if user == nil {
		return nil, apperror.Unauthorized("API 令牌无效、已过期或已被撤销")
	}

	// Recorded to the minute, sparing a write per request.
	if token.LastUsedAt == nil || time.Since(*token.LastUsedAt) > time.Minute {
		if err := s.repo.Token.Touch(ctx, token.ID); err != nil {
			return nil, err
		}
	}
	return &rbac.Identity{UserID: user.ID, Role: user.Role, Scope: token.Scope}, nil
}

func (s *AuthService) activeUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil || user == nil || user.Status != model.UserStatusActive {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) newSession(userID string) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour * 30)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func (s *AuthService) parseSession(tokenString string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return "", err
	}
	return token.Claims.(*Claims).UserID, nil
}

func (s *AuthService) ListTokens(ctx context.Context, viewer *rbac.Identity) ([]*model.APIToken, error) {
	return s.repo.Token.List(ctx, viewer.UserID)
}

// CreateToken returns the token with its secret, which is never shown again; a zero ttl never expires.
func (s *AuthService) CreateToken(ctx context.Context, viewer *rbac.Identity, name, scope string, ttl time.Duration) (*model.APIToken, string, error) {
	if scope == rbac.ScopeAdmin && viewer.Role != rbac.RoleAdmin {
		return nil, "", apperror.Forbidden("只有管理员可以创建管理权限的令牌").OnField("scope")
	}

	secret := tokenPrefix + rand.Text()
	token := &model.APIToken{UserID: viewer.UserID, Name: name, Hint: secret[len(secret)-4:], Scope: scope}
	if ttl > 0 {
		expires := time.Now().Add(ttl)
		token.ExpiresAt = &expires
	}
	created, err := s.repo.Token.Create(ctx, token, hashToken(secret))
	return created, secret, err
}

func (s *AuthService) DeleteToken(ctx context.Context, viewer *rbac.Identity, id string) error {
	ok, err := s.repo.Token.Delete(ctx, viewer.UserID, id)
	if err == nil && !ok {
		err = apperror.NotFound("令牌不存在")
	}
	return err
}

func hashToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func createUser(ctx context.Context, repo *repository.Provider, username, email, password, role string) (*model.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if existing, err := repo.User.GetByUsername(ctx, username); err != nil || existing != nil {
		if err == nil {
			err = apperror.Conflict("该用户名已被使用").OnField("username")
		}
		return nil, err
	}
	if existing, err := repo.User.GetByEmail(ctx, email); err != nil || existing != nil {
		if err == nil {
			err = apperror.Conflict("该邮箱已注册").OnField("email")
		}
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	user, err := repo.User.Create(ctx, username, email, string(hash), role)
	if repository.IsUniqueViolation(err) {
		return nil, apperror.Conflict("用户名或邮箱已被使用")
	}
	return user, err
}

func setPassword(ctx context.Context, r *repository.Repos, userID, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return r.User.SetPassword(ctx, userID, string(hash))
}

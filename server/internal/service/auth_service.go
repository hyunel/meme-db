package service

import (
	"context"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

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
	token, err := s.generateToken(user.ID)
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

	token, err := s.generateToken(user.ID)
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

// GetIdentity loads the identity of an active user.
func (s *AuthService) GetIdentity(ctx context.Context, userID string) (*rbac.Identity, error) {
	user, err := s.repo.User.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status != model.UserStatusActive {
		return nil, apperror.Unauthorized("用户不存在或已被禁用")
	}
	return rbac.NewIdentity(userID, user.Role), nil
}

func (s *AuthService) generateToken(userID string) (string, error) {
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

func (s *AuthService) ParseToken(tokenString string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return "", apperror.Unauthorized("登录已失效")
	}
	return token.Claims.(*Claims).UserID, nil
}

// Ensure AuthService implements rbac.IdentityProvider
var _ rbac.IdentityProvider = (*AuthService)(nil)

// createUser creates a user after checking that the username and email are free.
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

package service

import (
	"context"
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
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func (s *AuthService) Register(ctx context.Context, username, email, password string) (string, *model.User, error) {
	existing, err := s.repo.User.GetByUsername(ctx, username)
	if err != nil {
		return "", nil, err
	}
	if existing != nil {
		return "", nil, apperror.BadRequest("username already exists")
	}

	existingEmail, err := s.repo.User.GetByEmail(ctx, email)
	if err != nil {
		return "", nil, err
	}
	if existingEmail != nil {
		return "", nil, apperror.BadRequest("email already exists")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", nil, err
	}

	user, err := s.repo.User.Create(ctx, username, email, string(hashedPassword), rbac.RoleUser)
	if err != nil {
		return "", nil, err
	}

	token, err := s.GenerateToken(user.ID, user.Role)
	if err != nil {
		return "", nil, err
	}

	return token, user, nil
}

func (s *AuthService) GetUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.Unauthorized("user not found")
	}
	return user, nil
}

// GetIdentity retrieves the RBAC identity for a user from database.
func (s *AuthService) GetIdentity(userID string) (*rbac.Identity, error) {
	ctx := context.Background()
	user, err := s.repo.User.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.Unauthorized("user not found")
	}

	return rbac.NewIdentity(userID, user.Role), nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (string, *model.User, error) {
	user, err := s.repo.User.GetByEmail(ctx, email)
	if err != nil {
		return "", nil, err
	}
	if user == nil {
		return "", nil, apperror.Unauthorized("invalid email or password")
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return "", nil, apperror.Unauthorized("invalid email or password")
	}

	token, err := s.GenerateToken(user.ID, user.Role)
	if err != nil {
		return "", nil, err
	}

	return token, user, nil
}

func (s *AuthService) GenerateToken(userID, role string) (string, error) {
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour * 30)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func (s *AuthService) ParseToken(tokenString string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, apperror.Unauthorized("unexpected signing method")
		}
		return []byte(s.cfg.JWTSecret), nil
	})

	if err != nil {
		return "", apperror.Unauthorized("invalid token")
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims.UserID, nil
	}

	return "", apperror.Unauthorized("invalid token")
}

// Ensure AuthService implements rbac.IdentityProvider
var _ rbac.IdentityProvider = (*AuthService)(nil)

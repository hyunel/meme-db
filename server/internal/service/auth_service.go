package service

import (
	"context"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/hyunel/MemeDB/internal/config"
	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	cfg  *config.Config
	repo *repository.Provider
}

func NewAuthService(cfg *config.Config, repo *repository.Provider) *AuthService {
	return &AuthService{
		cfg:  cfg,
		repo: repo,
	}
}

type Claims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

func (s *AuthService) Register(ctx context.Context, username, email, password string) (string, *model.User, error) {
	// Check if username or email exists
	// We use two separate checks here because username and email are different inputs.
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

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", nil, err
	}

	user, err := s.repo.User.CreateUser(ctx, username, email, string(hashedPassword))

	if err != nil {
		return "", nil, err
	}

	token, err := s.GenerateToken(user.ID)
	if err != nil {
		return "", nil, err
	}

	return token, user, nil
}

func (s *AuthService) GetUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.Unauthorized("user not found")
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (string, *model.User, error) {
	user, err := s.repo.User.GetByEmail(ctx, email)
	if err != nil {
		return "", nil, err
	}
	if user == nil {
		return "", nil, apperror.Unauthorized("invalid email or password")
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return "", nil, apperror.Unauthorized("invalid email or password")
	}

	token, err := s.GenerateToken(user.ID)
	if err != nil {
		return "", nil, err
	}

	return token, user, nil
}

func (s *AuthService) GenerateToken(userID string) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour * 30)), // 30 days
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.Server.JWTSecret))
}

func (s *AuthService) ParseToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, apperror.Unauthorized("unexpected signing method")
		}
		return []byte(s.cfg.Server.JWTSecret), nil
	})

	if err != nil {
		return nil, apperror.Unauthorized("invalid token")
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, apperror.Unauthorized("invalid token")
}

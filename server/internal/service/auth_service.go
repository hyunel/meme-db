package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

// Marks API tokens, so they are told apart wherever they turn up.
const tokenPrefix = "mdb_"

type AuthServiceConfig struct {
	SessionTTL time.Duration // A session lapses after this long unused
}

type AuthService struct {
	cfg  AuthServiceConfig
	repo *repository.Provider
}

func NewAuthService(cfg AuthServiceConfig, repo *repository.Provider) *AuthService {
	return &AuthService{cfg: cfg, repo: repo}
}

// SignIn is a new session, whose secret the browser keeps until it lapses.
type SignIn struct {
	User    *model.User
	Secret  string
	Expires time.Time
}

func (s *AuthService) Register(ctx context.Context, username, email, password, userAgent, ip string) (*SignIn, error) {
	user, err := createUser(ctx, s.repo, username, email, password, rbac.RoleUser)
	if err != nil {
		return nil, err
	}
	return s.signIn(ctx, user, userAgent, ip)
}

func (s *AuthService) Login(ctx context.Context, email, password, userAgent, ip string) (*SignIn, error) {
	user, err := s.repo.User.GetByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if user == nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return nil, apperror.Unauthorized("invalid_credentials", "wrong email or password")
	}
	if user.Status != model.UserStatusActive {
		return nil, apperror.Forbidden("account_disabled", "the account is disabled; contact an admin")
	}
	return s.signIn(ctx, user, userAgent, ip)
}

func (s *AuthService) signIn(ctx context.Context, user *model.User, userAgent, ip string) (*SignIn, error) {
	// Sign-ins are rare enough to sweep away the user's lapsed sessions as they come.
	if err := s.repo.Session.DeleteExpired(ctx, user.ID); err != nil {
		return nil, err
	}
	secret := rand.Text()
	session := &model.Session{UserID: user.ID, UserAgent: userAgent, IP: ip, ExpiresAt: time.Now().Add(s.cfg.SessionTTL)}
	if _, err := s.repo.Session.Create(ctx, session, hashToken(secret)); err != nil {
		return nil, err
	}
	return &SignIn{User: user, Secret: secret, Expires: session.ExpiresAt}, nil
}

// Logout ends the viewer's session, if they are signed in with one.
func (s *AuthService) Logout(ctx context.Context, viewer *rbac.Identity) error {
	if viewer.SessionID == "" {
		return nil
	}
	_, err := s.repo.Session.Delete(ctx, viewer.UserID, viewer.SessionID)
	return err
}

// Me returns the viewer, and for a session when it now lapses, give or take the minute its use is recorded to.
func (s *AuthService) Me(ctx context.Context, viewer *rbac.Identity) (*model.User, time.Time, error) {
	user, err := s.GetUser(ctx, viewer.UserID)
	if err != nil || viewer.SessionID == "" {
		return user, time.Time{}, err
	}
	return user, time.Now().Add(s.cfg.SessionTTL), nil
}

func (s *AuthService) GetUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperror.Unauthorized("user_not_found", "user not found")
	}
	return user, nil
}

// ChangePassword signs the viewer out everywhere else.
func (s *AuthService) ChangePassword(ctx context.Context, viewer *rbac.Identity, current, next string) error {
	user, err := s.GetUser(ctx, viewer.UserID)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(current)) != nil {
		return apperror.BadRequest("wrong_password", "the current password is wrong").OnField("current_password")
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		if err := setPassword(ctx, r, viewer.UserID, next); err != nil {
			return err
		}
		return r.Session.DeleteAll(ctx, viewer.UserID, viewer.SessionID)
	})
}

// Authenticate rejects a bad API token, so that a script never silently runs as a guest.
func (s *AuthService) Authenticate(ctx context.Context, token string) (*rbac.Identity, error) {
	t, err := s.repo.Token.GetByHash(ctx, hashToken(token))
	if err != nil {
		return nil, err
	}
	var user *model.User
	if t != nil && (t.ExpiresAt == nil || t.ExpiresAt.After(time.Now())) {
		if user, err = s.activeUser(ctx, t.UserID); err != nil {
			return nil, err
		}
	}
	if user == nil {
		return nil, apperror.Unauthorized("invalid_token", "the API token is invalid, expired or revoked")
	}

	// Recorded to the minute, sparing a write per request.
	if t.LastUsedAt == nil || time.Since(*t.LastUsedAt) > time.Minute {
		if err := s.repo.Token.Touch(ctx, t.ID); err != nil {
			return nil, err
		}
	}
	return &rbac.Identity{UserID: user.ID, Role: user.Role, Scope: t.Scope}, nil
}

// Session resolves a session cookie, which the web app learns has lapsed through /auth/me.
func (s *AuthService) Session(ctx context.Context, secret string) (*rbac.Identity, error) {
	session, err := s.repo.Session.GetByHash(ctx, hashToken(secret))
	if err != nil || session == nil {
		return nil, err
	}
	user, err := s.activeUser(ctx, session.UserID)
	if err != nil || user == nil {
		return &rbac.Identity{Role: rbac.RoleGuest}, err // A disabled user's sessions resume once they are enabled again
	}

	// Use keeps a session alive; recorded to the minute, sparing a write per request.
	if time.Since(session.LastUsedAt) > time.Minute {
		if err := s.repo.Session.Touch(ctx, session.ID, time.Now().Add(s.cfg.SessionTTL)); err != nil {
			return nil, err
		}
	}
	return &rbac.Identity{UserID: user.ID, Role: user.Role, SessionID: session.ID}, nil
}

var _ rbac.Authenticator = (*AuthService)(nil)

func (s *AuthService) activeUser(ctx context.Context, id string) (*model.User, error) {
	user, err := s.repo.User.Get(ctx, id)
	if err != nil || user == nil || user.Status != model.UserStatusActive {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) Sessions(ctx context.Context, viewer *rbac.Identity) ([]*model.Session, error) {
	return listSessions(ctx, s.repo.Repos, viewer, viewer.UserID)
}

// DeleteSessions ends one of the viewer's sessions, or without an id all but the current one.
func (s *AuthService) DeleteSessions(ctx context.Context, viewer *rbac.Identity, id string) error {
	return deleteSessions(ctx, s.repo.Repos, viewer, viewer.UserID, id)
}

func (s *AuthService) ListTokens(ctx context.Context, viewer *rbac.Identity) ([]*model.APIToken, error) {
	return s.repo.Token.List(ctx, viewer.UserID)
}

// CreateToken returns the token with its secret, which is never shown again; a zero ttl never expires.
func (s *AuthService) CreateToken(ctx context.Context, viewer *rbac.Identity, name, scope string, ttl time.Duration) (*model.APIToken, string, error) {
	if scope == rbac.ScopeAdmin && viewer.Role != rbac.RoleAdmin {
		return nil, "", apperror.Forbidden("admin_scope_forbidden", "only admins can create admin-scoped tokens").OnField("scope")
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
		err = apperror.NotFound("token_not_found", "token not found")
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
			err = apperror.Conflict("username_taken", "the username is taken").OnField("username")
		}
		return nil, err
	}
	if existing, err := repo.User.GetByEmail(ctx, email); err != nil || existing != nil {
		if err == nil {
			err = apperror.Conflict("email_taken", "the email is already registered").OnField("email")
		}
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	user, err := repo.User.Create(ctx, username, email, string(hash), role)
	if repository.IsUniqueViolation(err) {
		return nil, apperror.Conflict("account_taken", "the username or email is taken")
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

func listSessions(ctx context.Context, r *repository.Repos, viewer *rbac.Identity, userID string) ([]*model.Session, error) {
	sessions, err := r.Session.List(ctx, userID)
	for _, session := range sessions {
		session.Current = session.ID == viewer.SessionID
	}
	return sessions, err
}

// deleteSessions ends one of the user's sessions, or without an id all of them but the viewer's own.
func deleteSessions(ctx context.Context, r *repository.Repos, viewer *rbac.Identity, userID, id string) error {
	if id == "" {
		return r.Session.DeleteAll(ctx, userID, viewer.SessionID)
	}
	ok, err := r.Session.Delete(ctx, userID, id)
	if err == nil && !ok {
		err = apperror.NotFound("session_not_found", "session not found")
	}
	return err
}

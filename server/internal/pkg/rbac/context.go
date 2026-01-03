package rbac

// Identity represents the authenticated user's identity with their role.
type Identity struct {
	UserID string
	Role   string
}

// NewIdentity creates a new Identity.
func NewIdentity(userID, role string) *Identity {
	return &Identity{
		UserID: userID,
		Role:   role,
	}
}

// GuestIdentity returns the default guest identity.
func GuestIdentity() *Identity {
	return &Identity{Role: RoleGuest}
}

// Level returns the privilege level of this identity's role.
func (i *Identity) Level() int {
	if i == nil {
		return LevelGuest
	}
	if level, ok := RoleLevel[i.Role]; ok {
		return level
	}
	return LevelGuest
}

// AtLeast checks if this identity has at least the specified privilege level.
func (i *Identity) AtLeast(level int) bool {
	return i.Level() >= level
}

// IsAuthenticated returns true if the identity represents an authenticated user.
func (i *Identity) IsAuthenticated() bool {
	return i != nil && i.UserID != ""
}

// IsAdmin returns true if the identity has admin privileges.
func (i *Identity) IsAdmin() bool {
	return i.AtLeast(LevelAdmin)
}

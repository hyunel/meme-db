// Package rbac provides role-based access control for the application.
package rbac

const (
	RoleGuest = "guest"
	RoleUser  = "user"
	RoleAdmin = "admin"
)

type Identity struct {
	UserID string // Empty for guests
	Role   string
}

func (i *Identity) IsAdmin() bool {
	return i != nil && i.Role == RoleAdmin
}
